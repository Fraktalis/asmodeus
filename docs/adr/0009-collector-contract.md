# ADR-0009: Collector contract

- Status: Accepted
- Date: 2026-10-28
- Amended: 2026-10-28 — `collect()` returns an explicit `CollectResult` (found while implementing phase 1: an empty observation list cannot distinguish "source down" from "no entities").

## Decision

```ts
interface CollectorType<C> {
  type: string;                     // "uptime_kuma", "vikunja", "generic_http"
  configSchema: z.ZodType<C>;
  create(config: C, ctx: Ctx): Collector;
}

interface Collector {
  health(): Promise<Health>;         // is the source reachable and authenticated?
  collect(): Promise<CollectResult>; // current state of entities; idempotent
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

type CollectResult =
  | { ok: true; observations: Observation[] }
  | { ok: false; error: string };
```

- Pull only in v1, with a per-collector interval. Push/webhook collectors are deferred.
- A collector never throws out of `health()`/`collect()`. A source-level failure (unreachable, wrong credentials, unparseable response) is an explicit `{ ok: false, error }`: the engine then keeps the last known entities instead of treating them as vanished, and raises `core.collector_unreachable` after a threshold. An entity whose own state cannot be determined is reported with status `unknown`.
- Each collector type also ships its rules (ADR-0011), namespaced `<type>.<rule>`.
- No action methods (ADR-0002).

## Consequences

- A generic conformance suite runs against every collector type using fixtures (hand-written from the documented API formats until real responses are recorded): Zod schema validity, unique and stable `entityKey`s, no escaping exceptions. A collector that violates the contract fails CI.
- The same fixtures feed the local mock servers (`dev/mocks/`).
