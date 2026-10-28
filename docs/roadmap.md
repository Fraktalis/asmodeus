# Roadmap

Each phase starts by settling its deferred decisions (see [`CONTEXT.md`](../CONTEXT.md#deferred-decisions)).

## Phase 1 — Backend vertical slice

- Bun workspaces: `packages/contracts`, `packages/server` (`packages/web` empty).
- `asmodeus.yaml` loader with Zod validation and `${ENV}` interpolation.
- Collector contract (ADR-0009) and generic conformance suite.
- Collectors: Uptime Kuma, Vikunja.
- `Store` port + SQLite adapter (Drizzle migrations) with its conformance suite: latest observations, transitions, attention items.
- Minimal rule engine with the rules of both collectors; auto-resolve and flapping.
- `GET /api/overview` protected by service tokens; `auth: none` only on `127.0.0.1`.
- Dockerfile, `compose.dev.yaml`, mock servers in `dev/mocks/` replaying recorded fixtures.
- GitHub Actions: tests on every push, GHCR image on tags.

**Acceptance**
- `docker compose -f compose.dev.yaml up` starts Asmodeus plus mock Uptime Kuma and Vikunja servers; `GET /api/overview` returns a valid snapshot containing at least one rule-derived attention item.
- The conformance suite fails if a collector violates the contract.
- Optional: the same config pointed at real instances works without code changes.

## Phase 2 — UI and human auth

- React client, exceptions-first overview, acknowledge/snooze/dismiss.
- Push channel to the UI (WebSocket or SSE — to decide).
- OIDC login (ADR-0004).
- After this phase: first real deployment (reference deployment consumes the GHCR image from its own infra repo).

## Phase 3 — MCP and more collectors

- Read-only MCP server over HTTP, built on collector `tools()`.
- Collectors: Home Assistant, Docker via socket proxy, What's Up Docker, calendar, `generic_http`.
- Failure memory to deduplicate alerts and avoid repair loops.

## Phase 4 — LLM foundation and news

- `LlmProvider` (Anthropic + OpenAI-compatible), roles, hard budget caps, `llm_runs`, `audit` (ADR-0012).
- News module: `freshrss` and `rss` sources, dedup, clustering, Hype/Facts/Signal scoring, feedback, digest API (ADR-0013).

## Phase 5 — Triage agent

- Scheduled agent reading the attention queue: triage and synthesis.
- Decide autonomy levels and whether any write to a source is allowed (ADR-0002).
