# ADR-0010: Attention items

- Status: Accepted
- Date: 2026-10-28

## Decision

- **Creation**: by deterministic rules evaluated on observations (later also by the agent, with `origin: agent`).
- **Deduplication key**: `ruleId + entityKey`.
- **Lifecycle**: `open → acknowledged → resolved`, with side exits `snoozed` (until `revisitAt`) and `dismissed`.
- **Auto-resolve**: an item resolves automatically when its condition clears. Reopening within a configured window increments a flapping counter on the same item instead of creating a new one.
- **Fields**: `attentionReason`, `decisionNeeded`, `revisitAt`, `evidence` (observation/transition references), `origin`, `flapCount`, timestamps.
- Acknowledge/snooze/dismiss write only to Asmodeus' store (compatible with ADR-0002).

## Consequences

- Without auto-resolve the queue rots and stops being read; this is non-negotiable.
- The overview orders items by state and severity: blocking, stale, decisions pending, last-24h activity.
