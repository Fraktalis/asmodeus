# Asmodeus

A self-hosted, AI-native overview of everything you run. Deterministic collectors read your services (Uptime Kuma, Vikunja, Home Assistant, Docker, calendars, news feeds…) into a single store; the UI shows **what needs your attention first**; an optional LLM layer analyses news and triages the queue.

> Status: phase 1 (backend). API only, no UI yet. See the [roadmap](docs/roadmap.md).

## Principles

- **Read-only toward your services.** Asmodeus never writes to sources or touches your infrastructure.
- **Deterministic first.** With every LLM feature disabled, the dashboard is complete.
- **Generic.** Your realm is declared in `asmodeus.yaml`; nothing deployment-specific lives in code.
- **Secure by default.** Scoped service tokens (OIDC for humans in phase 2); unauthenticated mode only on localhost.

## Try it locally

Runs Asmodeus against fake Uptime Kuma and Vikunja servers:

```bash
docker compose -f compose.dev.yaml up --build
```

```bash
curl -H 'authorization: Bearer asm_dev_token_not_secret' http://127.0.0.1:8080/api/overview
```

Without Docker (Bun ≥ 1.4):

```bash
bun install && bun run mocks
```

```bash
sed 's#http://mocks:9999#http://127.0.0.1:9999#; s#dataDir: /data#dataDir: ./data#' examples/dev/asmodeus.yaml > asmodeus.yaml
cd packages/server && ASMODEUS_CONFIG=../../asmodeus.yaml bun start
```

## Configure

Copy [`examples/basic/asmodeus.yaml`](examples/basic/asmodeus.yaml). Secrets are referenced as `${ENV_VAR}`. Create a service token and put its digest in the config:

```bash
docker run --rm ghcr.io/fraktalis/asmodeus token:create
```

### Collectors

| Type | Reads | Rules |
|---|---|---|
| `uptime_kuma` | `/metrics` (API key) | `monitor_down`, `cert_expiring` |
| `vikunja` | open tasks (API token) | `task_overdue`, `urgent_stale` |

Every collector also feeds `core.collector_unreachable` when its source cannot be reached.

## API

| Route | Auth | |
|---|---|---|
| `GET /api/overview` | `overview:read` | Attention items (exceptions first), collector health, 24h pulse |
| `GET /healthz` | none | Liveness |

## Develop

```bash
bun install
```

```bash
bun test && bun run typecheck
```

```bash
bun run smoke
```

`bun run smoke` checks the phase 1 acceptance criterion against a running instance.

## Documentation

- [`CONTEXT.md`](CONTEXT.md): vocabulary, scope, deferred decisions
- [`docs/adr/`](docs/adr/): architecture decision records
- [`docs/roadmap.md`](docs/roadmap.md): phases and acceptance criteria

## License

[Apache-2.0](LICENSE)
