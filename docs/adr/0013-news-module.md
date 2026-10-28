# ADR-0013: News module — sources and delivery

- Status: Accepted
- Date: 2026-10-28

## Decision

- Two source types behind one interface: `freshrss` (Google Reader API; FreshRSS stays the fetcher) and plain `rss`/Atom (for users without FreshRSS). Both produce normalised **news items**.
- The pipeline (content hashing, dedup, cross-source clustering, Hype/Facts/Signal scoring, feedback that adjusts weights) only sees news items, regardless of origin.
- Asmodeus produces the analysis and exposes a digest through its API. It does not own notification channels: delivery is done by an external tool (e.g. an n8n workflow calling the API), which replaces rather than duplicates any existing digest.
- Delivered in phase 4, before the triage agent (phase 5): it is a closed, testable pipeline whose value is measurable against an existing digest, while the triage agent needs weeks of real attention-queue history to calibrate.

## Consequences

- Clustering method, scoring grid and feedback loop are decided at the start of phase 4.
