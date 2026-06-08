import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const archives = sqliteTable("archives", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  topic: text("topic").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  archiveId: integer("archive_id")
    .notNull()
    .references(() => archives.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadataJson: text("metadata_json"),
  runId: text("run_id"),
  runStatus: text("run_status"),
  runPhase: text("run_phase"),
  runLastHeartbeatAt: integer("run_last_heartbeat_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const archiveContexts = sqliteTable("archive_contexts", {
  archiveId: integer("archive_id")
    .primaryKey()
    .references(() => archives.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().$defaultFn(() => ""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const archiveResearchAngles = sqliteTable("archive_research_angles", {
  archiveId: integer("archive_id")
    .primaryKey()
    .references(() => archives.id, { onDelete: "cascade" }),
  anglesJson: text("angles_json").notNull().$defaultFn(() => "[]"),
  metaJson: text("meta_json").notNull().$defaultFn(() => "{}"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const archiveIntelligenceProfiles = sqliteTable("archive_intelligence_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  archiveId: integer("archive_id")
    .notNull()
    .unique()
    .references(() => archives.id, { onDelete: "cascade" }),
  agendaText: text("agenda_text"),
  committeeType: text("committee_type"),
  agendaClass: text("agenda_class"),
  primaryDimensions: text("primary_dimensions"),
  completedDivisions: text("completed_divisions"),
  evidenceRegistryJson: text("evidence_registry"),
  debateUtilityLog: text("debate_utility_log"),
  dimensionEngineHash: text("dimension_engine_hash"),
  sessionCount: integer("session_count").default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

export type DatabaseMigrationStep = {
  name: string;
  changed: boolean;
};

export type InitializeDatabaseOptions = {
  now?: () => Date;
};

export type InitializeDatabaseReport = {
  legacyArchiveId: number;
  steps: DatabaseMigrationStep[];
};

const LEGACY_ARCHIVE_NAME = "Legacy Archive";
const LEGACY_ARCHIVE_TOPIC = "General MUN research";

function tableExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { name: string } | undefined;
  return Boolean(row);
}

function indexExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(name) as { name: string } | undefined;
  return Boolean(row);
}

// Whitelist of allowed table names for SQL injection prevention
const ALLOWED_TABLES = new Set([
  "archives",
  "conversations",
  "messages",
  "archive_contexts",
  "archive_research_angles",
]);

function isTableNameAllowed(table: string): boolean {
  // Only allow alphanumeric and underscores, and must be in whitelist
  return /^[a-z_][a-z0-9_]*$/i.test(table) && ALLOWED_TABLES.has(table.toLowerCase());
}

function columnExists(sqlite: Database.Database, table: string, col: string): boolean {
  // Validate table name against whitelist to prevent SQL injection
  if (!isTableNameAllowed(table)) {
    console.error(`[db] columnExists: Table name "${table}" is not in the allowed whitelist`);
    return false;
  }
  if (!tableExists(sqlite, table)) {
    return false;
  }
  // Use parameterized query - table name is validated above
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((column) => column.name === col);
}

function getConversationColumns(sqlite: Database.Database): Array<{ name: string }> {
  if (!tableExists(sqlite, "conversations")) {
    return [];
  }
  return sqlite.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
}

function getConversationArchiveDeleteAction(sqlite: Database.Database): string | null {
  if (!tableExists(sqlite, "conversations")) {
    return null;
  }

  const foreignKeys = sqlite.prepare("PRAGMA foreign_key_list(conversations)").all() as Array<{
    table: string;
    from: string;
    on_delete: string;
  }>;

  const archiveForeignKey = foreignKeys.find((foreignKey) => (
    foreignKey.table === "archives" && foreignKey.from === "archive_id"
  ));

  return archiveForeignKey?.on_delete?.toLowerCase() ?? null;
}

function ensureArchivesTable(sqlite: Database.Database): boolean {
  const existed = tableExists(sqlite, "archives");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS archives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      topic TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return !existed;
}

function ensureMessagesTable(sqlite: Database.Database): boolean {
  const existed = tableExists(sqlite, "messages");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT,
      run_id TEXT,
      run_status TEXT,
      run_phase TEXT,
      run_last_heartbeat_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);
  let changed = !existed;
  for (const [column, definition] of [
    ["metadata_json", "TEXT"],
    ["run_id", "TEXT"],
    ["run_status", "TEXT"],
    ["run_phase", "TEXT"],
    ["run_last_heartbeat_at", "INTEGER"],
  ] as const) {
    if (!columnExists(sqlite, "messages", column)) {
      sqlite.exec(`ALTER TABLE messages ADD COLUMN ${column} ${definition};`);
      changed = true;
    }
  }
  return changed;
}

function ensureArchiveContextsTable(sqlite: Database.Database): boolean {
  const existed = tableExists(sqlite, "archive_contexts");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS archive_contexts (
      archive_id INTEGER PRIMARY KEY,
      summary TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(archive_id) REFERENCES archives(id) ON DELETE CASCADE
    );
  `);
  return !existed;
}

function ensureArchiveResearchAnglesTable(sqlite: Database.Database): boolean {
  const existed = tableExists(sqlite, "archive_research_angles");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS archive_research_angles (
      archive_id INTEGER PRIMARY KEY,
      angles_json TEXT NOT NULL DEFAULT '[]',
      meta_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(archive_id) REFERENCES archives(id) ON DELETE CASCADE
    );
  `);
  return !existed;
}

function ensureArchiveIntelligenceProfilesTable(sqlite: Database.Database): boolean {
  const existed = tableExists(sqlite, "archive_intelligence_profiles");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS archive_intelligence_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      archive_id INTEGER NOT NULL UNIQUE,
      agenda_text TEXT,
      committee_type TEXT,
      agenda_class TEXT,
      primary_dimensions TEXT,
      completed_divisions TEXT,
      evidence_registry TEXT,
      debate_utility_log TEXT,
      dimension_engine_hash TEXT,
      session_count INTEGER DEFAULT 0,
      updated_at INTEGER,
      FOREIGN KEY(archive_id) REFERENCES archives(id) ON DELETE CASCADE
    );
  `);
  return !existed;
}

function backfillArchiveResearchAngles(sqlite: Database.Database, now: Date): boolean {
  const result = sqlite.prepare(`
    INSERT INTO archive_research_angles (archive_id, angles_json, meta_json, updated_at)
    SELECT archives.id, '[]', '{}', ?
    FROM archives
    LEFT JOIN archive_research_angles ON archive_research_angles.archive_id = archives.id
    WHERE archive_research_angles.archive_id IS NULL
  `).run(now.getTime());

  return result.changes > 0;
}

function backfillArchiveIntelligenceProfiles(sqlite: Database.Database, now: Date): boolean {
  const result = sqlite.prepare(`
    INSERT INTO archive_intelligence_profiles (
      archive_id,
      agenda_text,
      committee_type,
      agenda_class,
      primary_dimensions,
      completed_divisions,
      evidence_registry,
      debate_utility_log,
      session_count,
      updated_at
    )
    SELECT archives.id, archives.topic, 'general', NULL, '[]', '[]', NULL, '[]', 0, ?
    FROM archives
    LEFT JOIN archive_intelligence_profiles ON archive_intelligence_profiles.archive_id = archives.id
    WHERE archive_intelligence_profiles.archive_id IS NULL
  `).run(now.getTime());

  return result.changes > 0;
}

function ensureArchiveIndexes(sqlite: Database.Database): boolean {
  const requiredIndexes = [
    {
      name: "idx_messages_conv_id",
      sql: "CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON messages(conversation_id);",
    },
    {
      name: "idx_messages_conv_created",
      sql: "CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);",
    },
    ...(columnExists(sqlite, "messages", "run_id")
      ? [{
          name: "idx_messages_run_id",
          sql: "CREATE INDEX IF NOT EXISTS idx_messages_run_id ON messages(run_id);",
        }]
      : []),
    ...(columnExists(sqlite, "conversations", "archive_id")
      ? [{
          name: "idx_conversations_archive_id",
          sql: "CREATE INDEX IF NOT EXISTS idx_conversations_archive_id ON conversations(archive_id);",
        }]
      : []),
  ];

  let changed = false;
  for (const index of requiredIndexes) {
    const existed = indexExists(sqlite, index.name);
    sqlite.exec(index.sql);
    if (!existed) {
      changed = true;
    }
  }

  return changed;
}

function ensureLegacyArchive(sqlite: Database.Database, now: Date): { legacyArchiveId: number; changed: boolean } {
  const existingArchive = sqlite
    .prepare("SELECT id FROM archives ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;

  if (existingArchive) {
    return {
      legacyArchiveId: existingArchive.id,
      changed: false,
    };
  }

  const insert = sqlite.prepare(`
    INSERT INTO archives (name, topic, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const result = insert.run(
    LEGACY_ARCHIVE_NAME,
    LEGACY_ARCHIVE_TOPIC,
    now.getTime(),
    now.getTime(),
  );

  return {
    legacyArchiveId: Number(result.lastInsertRowid),
    changed: true,
  };
}

function ensureConversationsTable(
  sqlite: Database.Database,
  legacyArchiveId: number,
): { changed: boolean; backfilledLegacyArchive: boolean } {
  const existed = tableExists(sqlite, "conversations");
  const columns = getConversationColumns(sqlite);
  const hasArchiveId = columns.some((column) => column.name === "archive_id");
  const deleteAction = getConversationArchiveDeleteAction(sqlite);
  const needsRebuild = !existed || !hasArchiveId || deleteAction !== "restrict";

  if (!needsRebuild) {
    return { changed: false, backfilledLegacyArchive: false };
  }

  let backfilledLegacyArchive = !existed || !hasArchiveId;

  sqlite.exec("PRAGMA foreign_keys = OFF;");

  const migrate = sqlite.transaction(() => {
    sqlite.exec("DROP TABLE IF EXISTS conversations__migration;");
    sqlite.exec(`
      CREATE TABLE conversations__migration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        archive_id INTEGER NOT NULL REFERENCES archives(id) ON DELETE RESTRICT,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    if (existed) {
      if (hasArchiveId) {
        sqlite.prepare(`
          INSERT INTO conversations__migration (id, archive_id, title, created_at)
          SELECT id, COALESCE(archive_id, ?), title, created_at
          FROM conversations
        `).run(legacyArchiveId);
      } else {
        sqlite.prepare(`
          INSERT INTO conversations__migration (id, archive_id, title, created_at)
          SELECT id, ?, title, created_at
          FROM conversations
        `).run(legacyArchiveId);
      }

      sqlite.exec("DROP TABLE conversations;");
    }

    sqlite.exec("ALTER TABLE conversations__migration RENAME TO conversations;");
  });

  try {
    migrate();
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON;");
  }

  return {
    changed: true,
    backfilledLegacyArchive,
  };
}

function backfillConversationArchives(sqlite: Database.Database, legacyArchiveId: number): boolean {
  if (!tableExists(sqlite, "conversations")) {
    return false;
  }
  if (!columnExists(sqlite, "conversations", "archive_id")) {
    return false;
  }

  const result = sqlite
    .prepare("UPDATE conversations SET archive_id = ? WHERE archive_id IS NULL")
    .run(legacyArchiveId);

  return result.changes > 0;
}

function backfillArchiveContexts(sqlite: Database.Database, now: Date): boolean {
  const result = sqlite.prepare(`
    INSERT INTO archive_contexts (archive_id, summary, updated_at)
    SELECT archives.id, '', ?
    FROM archives
    LEFT JOIN archive_contexts ON archive_contexts.archive_id = archives.id
    WHERE archive_contexts.archive_id IS NULL
  `).run(now.getTime());

  return result.changes > 0;
}

export function initializeDatabase(
  sqlite: Database.Database,
  options: InitializeDatabaseOptions = {},
): InitializeDatabaseReport {
  const now = options.now ?? (() => new Date());
  const currentTime = now();
  const steps: DatabaseMigrationStep[] = [];

  sqlite.exec("PRAGMA foreign_keys = ON;");

  steps.push({ name: "archives-table", changed: ensureArchivesTable(sqlite) });

  const legacyArchive = ensureLegacyArchive(sqlite, currentTime);
  steps.push({ name: "legacy-archive", changed: legacyArchive.changed });

  const conversationsMigration = ensureConversationsTable(sqlite, legacyArchive.legacyArchiveId);
  steps.push({
    name: "conversations-table",
    changed: conversationsMigration.changed,
  });
  const conversationArchiveBackfillChanged = backfillConversationArchives(sqlite, legacyArchive.legacyArchiveId);
  steps.push({
    name: "conversation-archive-backfill",
    changed: conversationsMigration.backfilledLegacyArchive || conversationArchiveBackfillChanged,
  });

  steps.push({ name: "messages-table", changed: ensureMessagesTable(sqlite) });
  steps.push({ name: "archive-contexts-table", changed: ensureArchiveContextsTable(sqlite) });
  steps.push({ name: "archive-research-angles-table", changed: ensureArchiveResearchAnglesTable(sqlite) });
  steps.push({ name: "archive-intelligence-profiles-table", changed: ensureArchiveIntelligenceProfilesTable(sqlite) });
  steps.push({
    name: "archive-context-backfill",
    changed: backfillArchiveContexts(sqlite, currentTime),
  });
  steps.push({
    name: "archive-research-angles-backfill",
    changed: backfillArchiveResearchAngles(sqlite, currentTime),
  });
  steps.push({
    name: "archive-intelligence-profiles-backfill",
    changed: backfillArchiveIntelligenceProfiles(sqlite, currentTime),
  });
  steps.push({ name: "indexes", changed: ensureArchiveIndexes(sqlite) });

  return {
    legacyArchiveId: legacyArchive.legacyArchiveId,
    steps,
  };
}

export function getDefaultDatabasePath(baseDir = process.cwd()): string {
  return path.join(path.resolve(baseDir, "data"), "chat.db");
}

export function createDatabaseConnection(dbPath = getDefaultDatabasePath()): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA cache_size = 10000;");
  return db;
}

function createDatabaseProxy() {
  let _sqlite: Database.Database | null = null;
  let _db: ReturnType<typeof drizzle> | null = null;

  function ensureDb() {
    if (!_db) {
      _sqlite = createDatabaseConnection();
      initializeDatabase(_sqlite);
      _db = drizzle(_sqlite);
    }
  }

  const dbProxy = new Proxy({} as ReturnType<typeof drizzle>, {
    get(_target, prop) {
      ensureDb();
      return (_db as any)[prop];
    },
  }) as ReturnType<typeof drizzle>;

  const sqliteProxy = new Proxy({} as Database.Database, {
    get(_target, prop) {
      ensureDb();
      return (_sqlite as any)[prop];
    },
  }) as Database.Database;

  return { db: dbProxy, sqlite: sqliteProxy };
}

const { db, sqlite } = createDatabaseProxy();
export { sqlite, db };
