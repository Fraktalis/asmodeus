# Asmodeus

A self-hosted, AI-native overview of everything you run. Deterministic collectors read your services (Uptime Kuma, Vikunja, Home Assistant, Docker, calendars, news feeds…) into a single store; the UI shows **what needs your attention first**; an optional LLM layer analyses news and triages the queue.

> Status: design phase. No runnable code yet.

## Principles

- **Read-only toward your services.** Asmodeus never writes to sources or touches your infrastructure.
- **Deterministic first.** With every LLM feature disabled, the dashboard is complete.
- **Generic.** Your realm is declared in `asmodeus.yaml`; nothing deployment-specific lives in code.
- **Secure by default.** OIDC for humans, scoped tokens for machines; unauthenticated mode only on localhost.

## Documentation

- [`CONTEXT.md`](CONTEXT.md) — vocabulary, scope, deferred decisions
- [`docs/adr/`](docs/adr/) — architecture decision records
- [`docs/roadmap.md`](docs/roadmap.md) — phases and acceptance criteria

## License

[Apache-2.0](LICENSE)
