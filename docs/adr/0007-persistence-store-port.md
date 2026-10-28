# ADR-0007: SQLite behind an async Store port

- Status: Accepted
- Date: 2026-10-28

## Context

Supporting SQLite and Postgres from day one was considered. With Drizzle that means two table definitions and two migration sets, dialect differences (JSON, timestamps, upserts, partial indexes), an async driver for Postgres versus a sync one for SQLite, and a doubled CI matrix — while the schema changes most. A single-instance dashboard storing a few megabytes is well served by SQLite in WAL mode.

## Decision

- v1 supports SQLite only.
- All persistence goes through an **async** `Store` port, covered by an engine-agnostic conformance test suite.
- A Postgres adapter can be added later by implementing the port and passing the same suite.

## Consequences

- The port is async even though `bun:sqlite` is synchronous (small overhead, no future refactor).
- Later tables (`llm_runs`, `audit`) arrive as ordinary migrations.
