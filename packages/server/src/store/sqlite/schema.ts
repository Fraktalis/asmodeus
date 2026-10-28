import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const observations = sqliteTable(
  "observations",
  {
    entityKey: text("entity_key").primaryKey(),
    collectorId: text("collector_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    summary: text("summary").notNull(),
    attributes: text("attributes", { mode: "json" }).notNull(),
    sourceUrl: text("source_url"),
    observedAt: text("observed_at").notNull(),
    statusSince: text("status_since").notNull(),
  },
  (t) => [index("observations_collector_idx").on(t.collectorId)],
);

export const transitions = sqliteTable(
  "transitions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityKey: text("entity_key").notNull(),
    collectorId: text("collector_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    at: text("at").notNull(),
  },
  (t) => [index("transitions_at_idx").on(t.at)],
);

export const collectorStates = sqliteTable("collector_states", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull(),
  error: text("error"),
  lastAttemptAt: text("last_attempt_at"),
  lastSuccessAt: text("last_success_at"),
  failingSince: text("failing_since"),
});

export const attentionItems = sqliteTable(
  "attention_items",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id").notNull(),
    entityKey: text("entity_key").notNull(),
    collectorId: text("collector_id").notNull(),
    origin: text("origin").notNull(),
    state: text("state").notNull(),
    severity: text("severity").notNull(),
    attentionReason: text("attention_reason").notNull(),
    decisionNeeded: text("decision_needed"),
    revisitAt: text("revisit_at"),
    flapCount: integer("flap_count").notNull(),
    evidence: text("evidence", { mode: "json" }).notNull(),
    sourceUrl: text("source_url"),
    openedAt: text("opened_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (t) => [
    index("attention_rule_entity_idx").on(t.ruleId, t.entityKey, t.openedAt),
    index("attention_state_idx").on(t.state),
  ],
);
