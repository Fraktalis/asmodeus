# ADR-0009: Collector contract

- Status: Accepted
- Date: 2026-10-28

## Decision

```ts
interface CollectorType<C> {
  type: string;                     // "uptime_kuma", "vikunja", "generic_http"
  configSchema: z.ZodType<C>;
  create(config: C, ctx: Ctx): Collector;
}

interface Collector {
  health(): Promise<Health>;         // is the source reachable and authenticated?
  collect(): Promise<Observation[]>; // current state of entities; idempotent
  tools(): ToolDef[];                // read-only queries exposed via MCP (phase 3)
}

type Observation = {
  entityKey: string;                 // stable, e.g. "uptime_kuma:main/vikunja"
  kind: string;
  status: "ok" | "warn" | "crit" | "unknown";
  summary: string;
  attributes: Record<string, unknown>;
  sourceUrl?: string;
  observedAt: string;                // ISO 8601
};
```

- Pull only in v1, with a per-collector interval. Push/webhook collectors are deferred.
- A collector never throws out of `health()`/`collect()`: failures become `unknown` with the cause.
- No action methods (ADR-0002).

## Consequences

- A generic conformance suite runs against every collector type using recorded fixtures: Zod schema validity, unique and stable `entityKey`s, no escaping exceptions. A collector that violates the contract fails CI.
- The same fixtures feed the local mock servers (`dev/mocks/`).
