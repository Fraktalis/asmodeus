# Asmodeus — Context

Asmodeus is a self-hosted, AI-native overview of everything you run: one place that lifts the roofs off your services (homelab, home automation, tasks, calendar, news) and shows **what needs your attention first**. Named after Lesage's *Le Diable boiteux*, where the demon Asmodée lifts the roofs of Madrid to show what happens inside every house at once.

Deterministic collectors feed a single store; the UI shows exceptions first; an optional LLM layer analyses news and, later, triages the attention queue. The deterministic core must remain complete and useful with every LLM feature disabled.

This file is the shared vocabulary. Decisions and their rationale live in [`docs/adr/`](docs/adr/); phases and acceptance criteria in [`docs/roadmap.md`](docs/roadmap.md).

## Glossary

| Term | Meaning |
|---|---|
| **Realm** | Everything one Asmodeus instance watches, as declared in `asmodeus.yaml`. |
| **Source** | An external system Asmodeus reads from (Uptime Kuma, Vikunja, Home Assistant, FreshRSS…). Sources stay the source of truth; Asmodeus never writes to them (ADR-0002). |
| **Collector type** | Code shipped in this repo that knows how to read one kind of source (`uptime_kuma`, `vikunja`, `generic_http`…). Defines a Zod `configSchema`. |
| **Collector** | A configured instance of a collector type (e.g. two `uptime_kuma` collectors for two hosts). Exposes `health()`, `collect()`, `tools()` (ADR-0009). |
| **Entity** | One thing a collector reports on, identified by a stable `entityKey` such as `uptime_kuma:main/vikunja`. |
| **Observation** | The state of an entity at a point in time: `status` (`ok` / `warn` / `crit` / `unknown`), `summary`, `attributes`, `sourceUrl`, `observedAt`. Only the latest observation per entity is kept. |
| **Transition** | An append-only record that an entity's status changed. Retained 90 days by default. |
| **Rule** | Deterministic logic that turns observations into attention items. Ships with its collector type; thresholds are overridable in config (ADR-0011). One core rule, `core.collector_unreachable`, applies to every collector. |
| **Collect result** | Outcome of one `collect()`: observations, or an explicit failure that keeps the last known entities (ADR-0009). |
| **Attention item** | Something that needs a human: created by a rule (or later by the agent), deduplicated by `ruleId + entityKey`, with a lifecycle (ADR-0010). |
| **Flapping** | An attention item reopening within a configured window after auto-resolving; counted on the existing item rather than creating a new one. |
| **Overview** | The single snapshot served by `GET /api/overview`: exceptions first, then per-collector health. |
| **Store** | The async persistence port. SQLite in v1; Postgres possible via a new adapter (ADR-0007). |
| **News item** | A normalised article from a `freshrss` or `rss` source, input to the news pipeline (ADR-0013). |
| **LLM role** | A named slot in config (`judge` = cheap gate model, `analyst` = strong model) mapped to a provider and model (ADR-0012). |
| **Service token** | A hashed, scoped bearer token used by machines (scripts, MCP clients, the agent, n8n). |

## Scope

In scope for the collector catalogue (in rough order of delivery): Uptime Kuma, Vikunja (all projects, filterable), `generic_http`, Home Assistant, Docker (through a socket proxy, never a raw `docker.sock` mount), What's Up Docker, CalDAV/calendar, FreshRSS, RSS/Atom.

Out of scope:
- Writing to sources or acting on infrastructure, until explicitly reopened (ADR-0002).
- Metric time series. Asmodeus consumes Prometheus/Uptime Kuma/etc. and keeps states, transitions and attention items; Grafana or similar remains the drill-down tool (ADR-0008).
- Notification channels. Delivery (mail, chat) is left to tools like n8n calling the Asmodeus API.
- Finance and time tracking (Firefly III, Kimai) for now.

## Deferred decisions

Each is settled at the start of the phase that needs it.

| Phase | Open question |
|---|---|
| 2 | WebSocket vs SSE for UI push; layout of the exceptions-first view. |
| 3 | MCP transport (Streamable HTTP expected), tool routing, MCP token scopes. |
| 4 | News clustering method (embeddings vs simhash), Hype/Facts/Signal scoring grid, feedback loop, default budget values. |
| 5 | Agent autonomy levels; whether the agent may create Vikunja tasks (first write to a source). |
| Later | Trusted proxy headers (`Remote-User`) auth, local password login, external collector plugins, Postgres adapter, push/webhook collectors. |
