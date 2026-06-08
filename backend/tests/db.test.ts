import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";

import { initializeDatabase } from "../src/db.js";

test("backfills legacy conversations into a default archive during startup", () => {
  const sqlite = new Database(":memory:");

  sqlite.exec(`
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO conversations (title, created_at) VALUES ('Legacy chat', 1704067200000);
  `);

  const report = initializeDatabase(sqlite, {
    now: () => new Date("2024-01-02T00:00:00.000Z"),
  });

  const archives = sqlite
    .prepare("SELECT id, name, topic, created_at, updated_at FROM archives")
    .all() as Array<{ id: number; name: string; topic: string; created_at: number; updated_at: number }>;
  assert.equal(archives.length, 1);
  assert.equal(archives[0]?.name, "Legacy Archive");
  assert.equal(archives[0]?.topic, "General MUN research");
  assert.equal(archives[0]?.created_at, Date.parse("2024-01-02T00:00:00.000Z"));
  assert.equal(archives[0]?.updated_at, Date.parse("2024-01-02T00:00:00.000Z"));

  const conversationColumns = sqlite.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  assert.ok(conversationColumns.some((column) => column.name === "archive_id"));

  const conversations = sqlite
    .prepare("SELECT id, title, archive_id FROM conversations")
    .all() as Array<{ id: number; title: string; archive_id: number }>;
  assert.deepEqual(conversations, [
    {
      id: 1,
      title: "Legacy chat",
      archive_id: archives[0]!.id,
    },
  ]);

  const contexts = sqlite
    .prepare("SELECT archive_id, summary FROM archive_contexts")
    .all() as Array<{ archive_id: number; summary: string }>;
  assert.deepEqual(contexts, [{ archive_id: archives[0]!.id, summary: "" }]);

  assert.ok(report.steps.some((step) => step.name === "conversations-table" && step.changed));
  assert.ok(report.steps.some((step) => step.name === "conversation-archive-backfill" && step.changed));
});

test("rebuilds conversations so archive deletes conflict when chats still exist", () => {
  const sqlite = new Database(":memory:");

  sqlite.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE archives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      topic TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      archive_id INTEGER REFERENCES archives(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO archives (id, name, topic, created_at, updated_at)
    VALUES (7, 'Active Archive', 'Topic', 1704067200000, 1704067200000);
    INSERT INTO conversations (id, archive_id, title, created_at)
    VALUES (9, 7, 'Existing chat', 1704067200000);
    PRAGMA foreign_keys = ON;
  `);

  const report = initializeDatabase(sqlite, {
    now: () => new Date("2024-01-03T00:00:00.000Z"),
  });

  assert.throws(
    () => sqlite.prepare("DELETE FROM archives WHERE id = ?").run(7),
    /FOREIGN KEY constraint failed/i,
  );

  const remainingConversation = sqlite
    .prepare("SELECT id, archive_id FROM conversations WHERE id = 9")
    .get() as { id: number; archive_id: number } | undefined;
  assert.deepEqual(remainingConversation, { id: 9, archive_id: 7 });

  assert.ok(report.steps.some((step) => step.name === "conversations-table" && step.changed));
});
