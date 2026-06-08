import { Router } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, archives as archivesTable, archiveContexts as archiveContextsTable, archiveResearchAngles as archiveResearchAnglesTable, conversations as conversationsTable } from "../db.js";
import { getGeminiClient, isGeminiEnabled } from "../lib/gemini-client.js";

export type ArchiveRecord = {
  id: number;
  name: string;
  topic: string;
  researchAngles?: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type DeleteArchiveIfSafeResult =
  | { status: "deleted"; archive: ArchiveRecord }
  | { status: "not_found" }
  | { status: "last_archive" }
  | { status: "has_conversations" };

type CreateArchiveInput = {
  name: string;
  topic: string;
};

type UpdateArchiveInput = {
  name?: string;
  topic?: string;
};

type AnglesMeta = {
  generatedAt?: string;
  model?: string;
  version?: string;
};

export interface ArchivesStore {
  listArchives(): Promise<ArchiveRecord[]>;
  createArchive(input: CreateArchiveInput): Promise<ArchiveRecord>;
  updateArchive(id: number, input: UpdateArchiveInput): Promise<ArchiveRecord | null>;
  getResearchAngles(id: number): Promise<{ archiveId: number; angles: string[]; meta: AnglesMeta } | null>;
  setResearchAngles(id: number, angles: string[], meta?: AnglesMeta): Promise<{ archiveId: number; angles: string[]; meta: AnglesMeta } | null>;
  deleteArchiveIfSafe(id: number): Promise<DeleteArchiveIfSafeResult>;
}

const CreateArchiveBody = z.object({
  name: z.string().trim().min(1).max(120),
  topic: z.string().trim().min(3).max(300),
});

const UpdateArchiveBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  topic: z.string().trim().min(3).max(300).optional(),
}).refine((data) => data.name || data.topic, {
  message: "name or topic is required",
});

const ArchiveParams = z.object({ id: z.coerce.number().int().positive() });
const ResearchAnglesBody = z.object({
  angles: z.array(z.string().trim().min(3).max(220)).min(1).max(20),
});
const GenerateAnglesBody = z.object({
  topic: z.string().trim().min(3).max(300).optional(),
  committee: z.string().trim().min(2).max(120).optional(),
});

function parseJsonArray(text: string): string[] {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 20);
  } catch {
    return [];
  }
}

function parseMeta(text: string): AnglesMeta {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return {};
    return {
      generatedAt: typeof (parsed as any).generatedAt === "string" ? (parsed as any).generatedAt : undefined,
      model: typeof (parsed as any).model === "string" ? (parsed as any).model : undefined,
      version: typeof (parsed as any).version === "string" ? (parsed as any).version : undefined,
    };
  } catch {
    return {};
  }
}

function buildHeuristicAngles(topic: string, committee?: string): string[] {
  const t = topic.trim();
  const c = committee?.trim();
  const base = [
    `Core background and timeline of ${t}`,
    `Immediate triggers and root causes behind ${t}`,
    `Statistical impact: deaths, displacement, and economic loss in ${t}`,
    `India's official position and diplomatic stakes on ${t}`,
    `UN resolutions, international law, and legal obligations related to ${t}`,
    `Geopolitical implications for regional and global stability around ${t}`,
    `Media narratives, propaganda risks, and information integrity in ${t}`,
    `Policy options and negotiation pathways for de-escalation in ${t}`,
    `Human rights and democratic-space implications linked to ${t}`,
    `Most likely committee interventions and bloc positions for ${t}`,
  ];
  if (c) base.unshift(`${c} mandate-specific framing for ${t}`);
  return [...new Set(base)].slice(0, 12);
}

async function generateAngles(topic: string, committee?: string): Promise<{ angles: string[]; meta: AnglesMeta }> {
  const fallback = buildHeuristicAngles(topic, committee);
  if (!isGeminiEnabled()) {
    return { angles: fallback, meta: { generatedAt: new Date().toISOString(), model: "heuristic", version: "v1" } };
  }
  try {
    const gemini = getGeminiClient();
    const prompt = [
      "Generate 10 concise research angles for an MUN archive topic.",
      "Each angle must be actionable for web research and source collection.",
      "Cover data, legal, policy, human rights, geopolitical, and narrative dimensions.",
      "Return ONLY valid JSON array of strings.",
      committee ? `Committee: ${committee}` : "",
      `Topic: ${topic}`,
    ].filter(Boolean).join("\n");
    const resp = await gemini.chat.completions.create({
      model: "gemini-2.5-flash",
      temperature: 0.2,
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.choices?.[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const parsed = parseJsonArray(jsonMatch ? jsonMatch[0] : text);
    const angles = parsed.length >= 6 ? parsed.slice(0, 12) : fallback;
    return {
      angles,
      meta: { generatedAt: new Date().toISOString(), model: "gemini-2.5-flash", version: "v1" },
    };
  } catch {
    return { angles: fallback, meta: { generatedAt: new Date().toISOString(), model: "heuristic", version: "v1" } };
  }
}

const drizzleArchivesStore: ArchivesStore = {
  async listArchives() {
    const rows = await db.select().from(archivesTable).orderBy(asc(archivesTable.createdAt));
    const angles = await db.select().from(archiveResearchAnglesTable);
    const angleMap = new Map<number, string[]>();
    for (const row of angles) angleMap.set(row.archiveId, parseJsonArray(row.anglesJson));
    return rows.map((row) => ({ ...row, researchAngles: angleMap.get(row.id) ?? [] }));
  },
  async createArchive(input) {
    const now = new Date();
    try {
      const archive = db.transaction((tx) => {
        const created = tx.insert(archivesTable).values({
          name: input.name,
          topic: input.topic,
          createdAt: now,
          updatedAt: now,
        } as any).returning().get();

        tx.insert(archiveContextsTable).values({
          archiveId: created.id,
          summary: "",
          updatedAt: now,
        }).onConflictDoNothing().run();

        tx.insert(archiveResearchAnglesTable).values({
          archiveId: created.id,
          anglesJson: "[]",
          metaJson: "{}",
          updatedAt: now,
        }).onConflictDoNothing().run();

        return created;
      });

      return archive;
    } catch (err) {
      console.error("[archives] createArchive transaction failed:", err);
      throw err;
    }
  },
  async updateArchive(id, input) {
    const [updated] = await db.update(archivesTable).set({
      ...(input.name ? { name: input.name } : {}),
      ...(input.topic ? { topic: input.topic } : {}),
      updatedAt: new Date(),
    } as any).where(eq(archivesTable.id, id)).returning();

    return updated ?? null;
  },
  async getResearchAngles(id) {
    const [row] = await db.select().from(archiveResearchAnglesTable).where(eq(archiveResearchAnglesTable.archiveId, id));
    if (!row) return null;
    return { archiveId: id, angles: parseJsonArray(row.anglesJson), meta: parseMeta(row.metaJson) };
  },
  async setResearchAngles(id, angles, meta) {
    const [archive] = await db.select({ id: archivesTable.id }).from(archivesTable).where(eq(archivesTable.id, id));
    if (!archive) return null;
    await db.insert(archiveResearchAnglesTable).values({
      archiveId: id,
      anglesJson: JSON.stringify(angles.slice(0, 20)),
      metaJson: JSON.stringify(meta ?? {}),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: archiveResearchAnglesTable.archiveId,
      set: {
        anglesJson: JSON.stringify(angles.slice(0, 20)),
        metaJson: JSON.stringify(meta ?? {}),
        updatedAt: new Date(),
      },
    });
    return { archiveId: id, angles: angles.slice(0, 20), meta: meta ?? {} };
  },
  async deleteArchiveIfSafe(id) {
    return db.transaction((tx) => {
      const archive = tx.select().from(archivesTable).where(eq(archivesTable.id, id)).get();
      if (!archive) return { status: "not_found" as const };

      const archiveCountRow = tx.select({ count: sql<number>`count(*)` }).from(archivesTable).get();
      if (Number(archiveCountRow?.count ?? 0) <= 1) return { status: "last_archive" as const };

      const linkedConversationCountRow = tx
        .select({ count: sql<number>`count(*)` })
        .from(conversationsTable)
        .where(eq(conversationsTable.archiveId, id))
        .get();
      if (Number(linkedConversationCountRow?.count ?? 0) > 0) return { status: "has_conversations" as const };

      const deleted = tx.delete(archivesTable).where(eq(archivesTable.id, id)).returning().get();
      return deleted
        ? { status: "deleted" as const, archive: deleted }
        : { status: "not_found" as const };
    });
  },
};

export function createArchivesRouter(store: ArchivesStore = drizzleArchivesStore) {
  const router = Router();

  router.get("/archives", async (_req, res) => {
    const rows = await store.listArchives();
    res.json({ archives: rows });
  });

  router.post("/archives", async (req, res) => {
    const parsed = CreateArchiveBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    try {
      const archiveInput = parsed.data as CreateArchiveInput;
      const archive = await store.createArchive(archiveInput);
      res.status(201).json(archive);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error("[archives] Failed to create archive:", message);
      if (stack) console.error(stack);
      res.status(500).json({
        error: "Failed to create archive",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      });
    }
  });

  router.patch("/archives/:id", async (req, res) => {
    const params = ArchiveParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const body = UpdateArchiveBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    try {
      const updateInput = body.data as UpdateArchiveInput;
      const updated = await store.updateArchive(params.data.id, updateInput);
      if (!updated) {
        res.status(404).json({ error: "Archive not found" });
        return;
      }

      res.json(updated);
    } catch (err) {
      console.error("[archives] Failed to update archive:", err);
      res.status(500).json({ error: "Failed to update archive" });
    }
  });

  router.delete("/archives/:id", async (req, res) => {
    const params = ArchiveParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    try {
      const result = await store.deleteArchiveIfSafe(params.data.id);
      if (result.status === "deleted") {
        res.status(204).end();
        return;
      }
      if (result.status === "not_found") {
        res.status(404).json({ error: "Archive not found" });
        return;
      }
      if (result.status === "last_archive") {
        res.status(400).json({ error: "At least one archive must remain" });
        return;
      }
      res.status(409).json({ error: "Archive still contains chats" });
    } catch (err) {
      console.error("[archives] Failed to delete archive:", err);
      res.status(500).json({ error: "Failed to delete archive" });
    }
  });

  router.get("/archives/:id/research-angles", async (req, res) => {
    const params = ArchiveParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const found = await store.getResearchAngles(params.data.id);
    if (!found) {
      res.status(404).json({ error: "Archive not found" });
      return;
    }
    res.json(found);
  });

  router.patch("/archives/:id/research-angles", async (req, res) => {
    const params = ArchiveParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const body = ResearchAnglesBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const updated = await store.setResearchAngles(params.data.id, body.data.angles, {
      generatedAt: new Date().toISOString(),
      model: "user-edited",
      version: "v1",
    });
    if (!updated) {
      res.status(404).json({ error: "Archive not found" });
      return;
    }
    res.json(updated);
  });

  router.post("/archives/:id/research-angles/generate", async (req, res) => {
    const params = ArchiveParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const body = GenerateAnglesBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [archive] = await db.select().from(archivesTable).where(eq(archivesTable.id, params.data.id));
    if (!archive) {
      res.status(404).json({ error: "Archive not found" });
      return;
    }
    const topic = body.data.topic?.trim() || archive.topic;
    const generated = await generateAngles(topic, body.data.committee);
    const saved = await store.setResearchAngles(params.data.id, generated.angles, generated.meta);
    res.json(saved);
  });

  return router;
}

export default createArchivesRouter();
