# ADR-0004: Authentication — OIDC for humans, scoped tokens for machines

- Status: Accepted
- Date: 2026-10-28

## Context

Asmodeus aggregates the state of an entire infrastructure, including vulnerabilities, which makes it a high-value target. It must support both VPN-only deployments and public exposure behind a reverse proxy. None of the studied reference projects handled auth correctly.

## Decision

- Humans: generic OIDC (issuer discovery, authorization code + PKCE). Any compliant provider works; Authentik is a tested one.
- Machines (scripts, n8n, MCP clients, the agent): bearer service tokens, stored hashed, with scopes.
- `auth: none` is accepted only when the server binds to `127.0.0.1`; startup fails otherwise.
- Phase 1 ships service tokens (protecting `/api/overview`); OIDC lands in phase 2.

## Consequences

- No password storage in v1.
- Deferred: trusted proxy headers (`Remote-User`/forward-auth, off by default when added — header spoofing risk if the port is not strictly firewalled) and local password login.
