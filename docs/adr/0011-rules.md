# ADR-0011: Where rules live

- Status: Accepted
- Date: 2026-10-28

## Decision

- Rules ship with their collector type in code (e.g. "monitor `crit` for more than 5 minutes", "task overdue", "image update with CVE").
- Thresholds are overridable and rules can be disabled per collector in `asmodeus.yaml`.
- `generic_http` can map a JSON field to an observation status, which acts as an implicit rule.
- No general rule DSL in v1.

## Consequences

- A rule DSL is a project of its own; overridable thresholds cover the expected needs. Revisit if users hit the limits.
