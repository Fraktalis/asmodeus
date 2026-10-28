import type { AttentionItem, CollectorSummary, Overview } from "@asmodeus/contracts";
import type { Store } from "../store/port";

export type OverviewCollector = { id: string; type: { type: string }; intervalSeconds: number };

const STATE_RANK: Partial<Record<AttentionItem["state"], number>> = { open: 0, acknowledged: 1 };
const SEVERITY_RANK = { crit: 0, warn: 1 } as const;
const PULSE_HOURS = 24;
/** A collector is stale when it has not succeeded for this many intervals. */
const STALE_INTERVALS = 3;

function byExceptionFirst(a: AttentionItem, b: AttentionItem): number {
  return (
    STATE_RANK[a.state]! - STATE_RANK[b.state]! ||
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    a.openedAt.localeCompare(b.openedAt)
  );
}

export async function buildOverview(store: Store, collectors: OverviewCollector[], now: Date): Promise<Overview> {
  const [items, states, observations, pulse] = await Promise.all([
    store.listAttentionItems({ states: ["open", "acknowledged"] }),
    store.listCollectorStates(),
    store.listObservations(),
    store.listTransitions({ since: new Date(now.getTime() - PULSE_HOURS * 3_600_000).toISOString() }),
  ]);

  const summaries: CollectorSummary[] = collectors.map((c) => {
    const state = states.find((s) => s.id === c.id);
    const entities = { ok: 0, warn: 0, crit: 0, unknown: 0 };
    for (const o of observations) if (o.collectorId === c.id) entities[o.status]++;
    const lastSuccessAt = state?.lastSuccessAt ?? null;
    return {
      id: c.id,
      type: c.type.type,
      ok: state?.ok ?? false,
      error: state?.error ?? null,
      lastAttemptAt: state?.lastAttemptAt ?? null,
      lastSuccessAt,
      stale: lastSuccessAt === null || now.getTime() - Date.parse(lastSuccessAt) > STALE_INTERVALS * c.intervalSeconds * 1000,
      entities,
    };
  });

  return {
    generatedAt: now.toISOString(),
    attention: items.sort(byExceptionFirst),
    collectors: summaries,
    pulse: pulse.slice(0, 200),
  };
}
