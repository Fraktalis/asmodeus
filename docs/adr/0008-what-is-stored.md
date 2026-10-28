# ADR-0008: What the store keeps

- Status: Accepted
- Date: 2026-10-28

## Context

Sources must remain the source of truth, yet reading them live on every request means a down source makes its own alerts disappear, staleness cannot be detected, and the overview is as slow as the slowest source. Mirroring sources fully duplicates data with no owner.

## Decision

The store keeps:
1. the **latest observation per entity** (overwritten on each collect);
2. an **append-only log of status transitions** (default retention 90 days, configurable);
3. **attention items** and their history.

It does not mirror source content (e.g. task descriptions or comments); observations carry a `sourceUrl` deep link instead. It stores no metric time series: Prometheus/Grafana or similar remain the drill-down tools.

## Consequences

- Staleness is detectable (`observedAt` older than the collector interval allows).
- The overview is served from the store, independent of source latency.
