import { Database } from "bun:sqlite";
import { and, desc, eq, gte, inArray, lt, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { AttentionItem, Status } from "@asmodeus/contracts";
import type { AttentionPatch, CollectorState, NewAttentionItem, Store, StoredObservation } from "../port";
import * as schema from "./schema";

const MIGRATIONS = new URL("../../../drizzle/sqlite", import.meta.url).pathname;

const iso = (s: string) => new Date(s).toISOString();
const isoOrNull = (s: string | null) => (s === null ? null : iso(s));

type AttentionRow = typeof schema.attentionItems.$inferSelect;
type ObservationRow = typeof schema.observations.$inferSelect;

function toItem(row: AttentionRow): AttentionItem {
  return {
    ...row,
    origin: row.origin as AttentionItem["origin"],
    state: row.state as AttentionItem["state"],
    severity: row.severity as AttentionItem["severity"],
    evidence: row.evidence as string[],
  };
}

function toObservation(row: ObservationRow): StoredObservation {
  const { sourceUrl, ...rest } = row;
  return {
    ...rest,
    status: row.status as Status,
    attributes: row.attributes as Record<string, unknown>,
    ...(sourceUrl === null ? {} : { sourceUrl }),
  };
}

/** Normalises every timestamp field present in an attention item or patch. */
function normaliseTimes<T extends Partial<AttentionItem>>(x: T): T {
  const out: Partial<AttentionItem> = { ...x };
  for (const k of ["openedAt", "updatedAt"] as const) if (out[k] !== undefined) out[k] = iso(out[k]!);
  for (const k of ["revisitAt", "resolvedAt"] as const) if (out[k] !== undefined) out[k] = isoOrNull(out[k]!);
  return out as T;
}

export function openSqliteStore(path: string): Store {
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });

  const { observations, transitions, collectorStates, attentionItems } = schema;

  return {
    async listObservations(filter = {}) {
      const rows = filter.collectorId
        ? db.select().from(observations).where(eq(observations.collectorId, filter.collectorId)).all()
        : db.select().from(observations).all();
      return rows.map(toObservation);
    },

    async putObservation(o) {
      const row = {
        entityKey: o.entityKey,
        collectorId: o.collectorId,
        kind: o.kind,
        status: o.status,
        summary: o.summary,
        attributes: o.attributes,
        sourceUrl: o.sourceUrl ?? null,
        observedAt: iso(o.observedAt),
        statusSince: iso(o.statusSince),
      };
      db.insert(observations).values(row).onConflictDoUpdate({ target: observations.entityKey, set: row }).run();
    },

    async deleteObservations(keys) {
      if (keys.length) db.delete(observations).where(inArray(observations.entityKey, keys)).run();
    },

    async appendTransition(t) {
      db.insert(transitions)
        .values({ entityKey: t.entityKey, collectorId: t.collectorId, fromStatus: t.from, toStatus: t.to, at: iso(t.at) })
        .run();
    },

    async listTransitions({ since }) {
      return db
        .select()
        .from(transitions)
        .where(gte(transitions.at, iso(since)))
        .orderBy(desc(transitions.at), desc(transitions.id))
        .all()
        .map((r) => ({
          entityKey: r.entityKey,
          collectorId: r.collectorId,
          from: r.fromStatus as Status | null,
          to: r.toStatus as Status,
          at: r.at,
        }));
    },

    async purgeTransitions(before) {
      return db.delete(transitions).where(lt(transitions.at, iso(before))).returning({ id: transitions.id }).all().length;
    },

    async putCollectorState(s) {
      const row: CollectorState = {
        ...s,
        lastAttemptAt: isoOrNull(s.lastAttemptAt),
        lastSuccessAt: isoOrNull(s.lastSuccessAt),
        failingSince: isoOrNull(s.failingSince),
      };
      db.insert(collectorStates).values(row).onConflictDoUpdate({ target: collectorStates.id, set: row }).run();
    },

    async listCollectorStates() {
      return db.select().from(collectorStates).all();
    },

    async insertAttentionItem(item: NewAttentionItem) {
      const row = { ...normaliseTimes(item), id: Bun.randomUUIDv7() };
      db.insert(attentionItems).values(row).run();
      return toItem(row);
    },

    async updateAttentionItem(id: string, patch: AttentionPatch) {
      const rows = db.update(attentionItems).set(normaliseTimes(patch)).where(eq(attentionItems.id, id)).returning().all();
      if (!rows[0]) throw new Error(`attention item ${id} not found`);
      return toItem(rows[0]);
    },

    async getAttentionItem(id) {
      const row = db.select().from(attentionItems).where(eq(attentionItems.id, id)).get();
      return row ? toItem(row) : null;
    },

    async latestAttentionItem(ruleId, entityKey) {
      const row = db
        .select()
        .from(attentionItems)
        .where(and(eq(attentionItems.ruleId, ruleId), eq(attentionItems.entityKey, entityKey)))
        .orderBy(desc(attentionItems.openedAt), desc(attentionItems.id))
        .get();
      return row ? toItem(row) : null;
    },

    async listAttentionItems(query = {}) {
      const where: SQL[] = [];
      if (query.states) where.push(inArray(attentionItems.state, query.states));
      if (query.collectorId) where.push(eq(attentionItems.collectorId, query.collectorId));
      return db
        .select()
        .from(attentionItems)
        .where(and(...where))
        .orderBy(desc(attentionItems.openedAt))
        .all()
        .map(toItem);
    },

    async close() {
      sqlite.close();
    },
  };
}
