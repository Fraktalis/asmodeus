# ADR-0006: Tech stack

- Status: Accepted
- Date: 2026-10-28

## Decision

- Runtime: Bun + TypeScript.
- Persistence: Drizzle ORM (schema + versioned migrations), SQLite via `bun:sqlite` in WAL mode (see ADR-0007).
- Validation: Zod for config, collector configs and the collector contract.
- Client: React + Vite + TanStack Query.
- Layout: Bun workspaces — `packages/contracts` (shared types and Zod schemas), `packages/server`, `packages/web`. One image serves API, push channel and static UI.
- Development: test-first.

## Consequences

- Distributed as a container image, so Bun's portability limits outside Docker do not matter.
