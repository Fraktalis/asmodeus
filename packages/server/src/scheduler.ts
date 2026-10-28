import type { Collector } from "@asmodeus/contracts";
import type { Engine } from "./engine";
import type { Store } from "./store/port";

export type ScheduledCollector = { id: string; intervalSeconds: number; collector: Collector };

const DAY_MS = 86_400_000;

/**
 * Pull loop: collects each collector immediately, then every interval. A collect still
 * running when the next tick comes is not doubled.
 */
export function startScheduler(opts: {
  engine: Engine;
  store: Store;
  collectors: ScheduledCollector[];
  retentionDays: number;
  log: (message: string) => void;
}) {
  const timers: Timer[] = [];
  const running = new Set<string>();

  async function tick({ id, collector }: ScheduledCollector) {
    if (running.has(id)) return;
    running.add(id);
    try {
      const result = await collector.collect();
      if (!result.ok) opts.log(`collector ${id}: ${result.error}`);
      await opts.engine.ingest(id, result, new Date());
    } catch (e) {
      opts.log(`collector ${id}: ingest failed: ${(e as Error).stack ?? e}`);
    } finally {
      running.delete(id);
    }
  }

  async function purge() {
    try {
      const removed = await opts.store.purgeTransitions(new Date(Date.now() - opts.retentionDays * DAY_MS).toISOString());
      if (removed) opts.log(`purged ${removed} transitions older than ${opts.retentionDays} days`);
    } catch (e) {
      opts.log(`purge failed: ${(e as Error).message}`);
    }
  }

  for (const c of opts.collectors) {
    void tick(c);
    timers.push(setInterval(() => void tick(c), c.intervalSeconds * 1000));
  }
  void purge();
  timers.push(setInterval(() => void purge(), DAY_MS));

  return { stop: () => timers.forEach(clearInterval) };
}
