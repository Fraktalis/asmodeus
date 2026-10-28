import { z } from "zod";

// --- Observations (ADR-0009) ---

export const StatusSchema = z.enum(["ok", "warn", "crit", "unknown"]);
export type Status = z.infer<typeof StatusSchema>;

export const ObservationSchema = z.object({
  entityKey: z.string().min(1),
  kind: z.string().min(1),
  status: StatusSchema,
  summary: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  sourceUrl: z.url().optional(),
  observedAt: z.iso.datetime(),
});
export type Observation = z.infer<typeof ObservationSchema>;

/**
 * Result of one collect. A failed collect is explicit so that the engine can keep
 * the last known entities instead of treating them as vanished (ADR-0008).
 */
export type CollectResult =
  | { ok: true; observations: Observation[] }
  | { ok: false; error: string };

export type Health = { ok: boolean; message?: string };

// --- Rules (ADR-0011) ---

export type Severity = "warn" | "crit";

export type EntityState = {
  observation: Observation;
  /** When the entity entered its current status. */
  statusSince: string;
};

export type RuleFinding = {
  severity: Severity;
  reason: string;
  decisionNeeded?: string;
};

export interface Rule<P = unknown> {
  id: string;
  description: string;
  /** Must accept `{}` and fill defaults. */
  paramsSchema: z.ZodType<P>;
  evaluate(entity: EntityState, now: Date, params: P): RuleFinding | null;
}

// --- Collectors (ADR-0009) ---

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  run(input: unknown): Promise<unknown>;
};

export interface Collector {
  /** Is the source reachable and authenticated? Never throws. */
  health(): Promise<Health>;
  /** Current state of all entities. Idempotent. Never throws. */
  collect(): Promise<CollectResult>;
  /** Read-only queries exposed over MCP (phase 3). */
  tools(): ToolDef[];
}

export type CollectorContext = {
  /** Collector instance id from config; prefix of every entityKey it emits. */
  id: string;
  now: () => Date;
  fetch: typeof fetch;
};

export interface CollectorType<C = unknown> {
  type: string;
  configSchema: z.ZodType<C>;
  rules: Rule<any>[];
  create(config: C, ctx: CollectorContext): Collector;
}

// --- Attention items (ADR-0010) ---

export const AttentionStateSchema = z.enum(["open", "acknowledged", "snoozed", "dismissed", "resolved"]);
export type AttentionState = z.infer<typeof AttentionStateSchema>;

export const AttentionItemSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  entityKey: z.string(),
  collectorId: z.string(),
  origin: z.enum(["rule", "agent"]),
  state: AttentionStateSchema,
  severity: z.enum(["warn", "crit"]),
  attentionReason: z.string(),
  decisionNeeded: z.string().nullable(),
  revisitAt: z.iso.datetime().nullable(),
  flapCount: z.number().int().nonnegative(),
  evidence: z.array(z.string()),
  sourceUrl: z.string().nullable(),
  openedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type AttentionItem = z.infer<typeof AttentionItemSchema>;

// --- Overview (GET /api/overview) ---

export const CollectorSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  lastAttemptAt: z.iso.datetime().nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
  stale: z.boolean(),
  entities: z.object({
    ok: z.number().int(),
    warn: z.number().int(),
    crit: z.number().int(),
    unknown: z.number().int(),
  }),
});
export type CollectorSummary = z.infer<typeof CollectorSummarySchema>;

export const TransitionSchema = z.object({
  entityKey: z.string(),
  collectorId: z.string(),
  from: StatusSchema.nullable(),
  to: StatusSchema,
  at: z.iso.datetime(),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const OverviewSchema = z.object({
  generatedAt: z.iso.datetime(),
  attention: z.array(AttentionItemSchema),
  collectors: z.array(CollectorSummarySchema),
  pulse: z.array(TransitionSchema),
});
export type Overview = z.infer<typeof OverviewSchema>;
