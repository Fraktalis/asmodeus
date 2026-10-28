# ADR-0002: Read-only toward sources

- Status: Accepted
- Date: 2026-10-28

## Context

Asmodeus holds credentials to many services. Infrastructure changes in the reference deployment go through GitOps (Git → CI → Ansible); out-of-band actions from a dashboard would bypass that model.

## Decision

Asmodeus never writes to sources and never acts on infrastructure (no container restarts, no task creation) through phase 4. Writes are limited to Asmodeus' own store (acknowledging, snoozing, dismissing attention items; feedback on news).

The question is reopened in phase 5 for one candidate write (creating a task from an attention item, with human confirmation). Any future write requires an audit log entry.

## Consequences

- Collector credentials should be read-only tokens wherever the source allows it.
- The collector contract has no `restart()` / action method.
- Docker access goes through a socket proxy with read-only endpoints; no `docker.sock` mount.
