# ADR-0003: Generic, config-driven, built-in collectors

- Status: Accepted
- Date: 2026-10-28

## Context

Asmodeus is meant to be published and reusable by others, not just one homelab.

## Decision

- No deployment-specific data (hosts, IPs, ports, project names) in code. A realm is declared in `asmodeus.yaml`, validated by Zod at startup; secrets are injected via `${ENV_VAR}` interpolation.
- Collector types are compiled into the repo. No dynamic loading of external plugins in v1.
- A declarative `generic_http` collector type covers HTTP/JSON sources without writing code, including mapping a JSON field to a status.

## Consequences

- No third-party code runs inside a process that holds tokens to the whole realm.
- New source kinds need a PR or `generic_http`. External plugins can be revisited if real users ask.
