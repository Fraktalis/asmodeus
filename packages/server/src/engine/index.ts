import type { AttentionItem, CollectResult, CollectorType, EntityState, RuleFinding } from "@asmodeus/contracts";
import type { RuleSettings } from "../config/load";
import type { AttentionPatch, Store, StoredObservation } from "../store/port";

export const COLLECTOR_UNREACHABLE = "core.collector_unreachable";

export type EngineCollector = {
  id: string;
  type: CollectorType<any>;
  rules: Record<string, RuleSettings>;
};

export type EngineOptions = {
  store: Store;
  collectors: EngineCollector[];
  flapWindowMinutes: number;
  collectorUnreachableMinutes: number;
  log?: (message: string) => void;
};

export interface Engine {
  /** Applies one collect result: observations, transitions, rules, attention items (ADR-0008, ADR-0010). */
  ingest(collectorId: string, result: CollectResult, now: Date): Promise<void>;
  acknowledge(itemId: string, now: Date): Promise<AttentionItem>;
  snooze(itemId: string, until: Date, now: Date): Promise<AttentionItem>;
  dismiss(itemId: string, now: Date): Promise<AttentionItem>;
}

const SEVERITY_RANK = { warn: 1, crit: 2 } as const;

type Target = { ruleId: string; entityKey: string; collectorId: string; sourceUrl: string | null; evidence: string[] };

export function createEngine(opts: EngineOptions): Engine {
  const { store } = opts;
  const log = opts.log ?? ((m) => console.warn(m));
  const collectors = new Map(opts.collectors.map((c) => [c.id, c]));

  async function applyFinding(target: Target, finding: RuleFinding | null, now: Date) {
    const latest = await store.latestAttentionItem(target.ruleId, target.entityKey);
    const isActive = latest !== null && latest.state !== "resolved";
    const nowIso = now.toISOString();

    if (!finding) {
      if (isActive) await store.updateAttentionItem(latest.id, { state: "resolved", resolvedAt: nowIso, updatedAt: nowIso });
      return;
    }

    const content = {
      severity: finding.severity,
      attentionReason: finding.reason,
      decisionNeeded: finding.decisionNeeded ?? null,
      sourceUrl: target.sourceUrl,
    };

    if (isActive) {
      const patch: AttentionPatch = {};
      for (const k of Object.keys(content) as (keyof typeof content)[]) {
        if (latest[k] !== content[k]) Object.assign(patch, { [k]: content[k] });
      }
      if (latest.state === "acknowledged" && SEVERITY_RANK[finding.severity] > SEVERITY_RANK[latest.severity]) {
        patch.state = "open";
      }
      if (Object.keys(patch).length) await store.updateAttentionItem(latest.id, { ...patch, evidence: target.evidence, updatedAt: nowIso });
      return;
    }

    const flapWindowMs = opts.flapWindowMinutes * 60_000;
    if (latest?.resolvedAt && now.getTime() - Date.parse(latest.resolvedAt) <= flapWindowMs) {
      await store.updateAttentionItem(latest.id, {
        ...content,
        state: "open",
        flapCount: latest.flapCount + 1,
        resolvedAt: null,
        revisitAt: null,
        evidence: target.evidence,
        updatedAt: nowIso,
      });
      return;
    }

    await store.insertAttentionItem({
      ...content,
      ruleId: target.ruleId,
      entityKey: target.entityKey,
      collectorId: target.collectorId,
      origin: "rule",
      state: "open",
      revisitAt: null,
      flapCount: 0,
      evidence: target.evidence,
      openedAt: nowIso,
      updatedAt: nowIso,
      resolvedAt: null,
    });
  }

  async function resolveAllFor(entityKey: string, now: Date) {
    const items = await store.listAttentionItems({ states: ["open", "acknowledged", "snoozed", "dismissed"] });
    for (const item of items.filter((i) => i.entityKey === entityKey)) {
      await store.updateAttentionItem(item.id, { state: "resolved", resolvedAt: now.toISOString(), updatedAt: now.toISOString() });
    }
  }

  async function wakeSnoozed(collectorId: string, now: Date) {
    for (const item of await store.listAttentionItems({ states: ["snoozed"], collectorId })) {
      if (item.revisitAt && Date.parse(item.revisitAt) <= now.getTime()) {
        await store.updateAttentionItem(item.id, { state: "open", revisitAt: null, updatedAt: now.toISOString() });
      }
    }
  }

  async function ingestObservations(c: EngineCollector, result: Extract<CollectResult, { ok: true }>, now: Date) {
    const nowIso = now.toISOString();
    const previous = new Map((await store.listObservations({ collectorId: c.id })).map((o) => [o.entityKey, o]));
    const current: StoredObservation[] = [];

    for (const o of result.observations) {
      const prev = previous.get(o.entityKey);
      const changed = !prev || prev.status !== o.status;
      const stored: StoredObservation = { ...o, collectorId: c.id, statusSince: changed ? nowIso : prev.statusSince };
      if (changed) {
        await store.appendTransition({ entityKey: o.entityKey, collectorId: c.id, from: prev?.status ?? null, to: o.status, at: nowIso });
      }
      await store.putObservation(stored);
      current.push(stored);
    }

    const seen = new Set(current.map((o) => o.entityKey));
    const vanished = [...previous.keys()].filter((k) => !seen.has(k));
    await store.deleteObservations(vanished);
    for (const key of vanished) await resolveAllFor(key, now);

    for (const rule of c.type.rules) {
      const settings = c.rules[rule.id];
      for (const o of current) {
        let finding: RuleFinding | null = null;
        if (settings?.enabled) {
          try {
            const entity: EntityState = { observation: o, statusSince: o.statusSince };
            finding = rule.evaluate(entity, now, settings.params);
          } catch (e) {
            log(`rule ${rule.id} failed on ${o.entityKey}: ${(e as Error).message}`);
            continue;
          }
        }
        await applyFinding(
          {
            ruleId: rule.id,
            entityKey: o.entityKey,
            collectorId: c.id,
            sourceUrl: o.sourceUrl ?? null,
            evidence: [`observation:${o.entityKey}@${o.observedAt}`],
          },
          finding,
          now,
        );
      }
    }
  }

  async function transition(itemId: string, allowed: AttentionItem["state"][], patch: AttentionPatch, now: Date) {
    const item = await store.getAttentionItem(itemId);
    if (!item) throw new Error(`attention item ${itemId} not found`);
    if (!allowed.includes(item.state)) throw new Error(`attention item ${itemId} is ${item.state}`);
    return store.updateAttentionItem(itemId, { ...patch, updatedAt: now.toISOString() });
  }

  return {
    async ingest(collectorId, result, now) {
      const c = collectors.get(collectorId);
      if (!c) throw new Error(`unknown collector ${collectorId}`);
      const nowIso = now.toISOString();
      const prev = (await store.listCollectorStates()).find((s) => s.id === collectorId);

      if (result.ok) {
        await store.putCollectorState({
          id: c.id, type: c.type.type, ok: true, error: null,
          lastAttemptAt: nowIso, lastSuccessAt: nowIso, failingSince: null,
        });
        await ingestObservations(c, result, now);
      } else {
        const failingSince = prev?.failingSince ?? nowIso;
        await store.putCollectorState({
          id: c.id, type: c.type.type, ok: false, error: result.error,
          lastAttemptAt: nowIso, lastSuccessAt: prev?.lastSuccessAt ?? null, failingSince,
        });
      }

      const failingMs = result.ok ? 0 : now.getTime() - Date.parse(prev?.failingSince ?? nowIso);
      await applyFinding(
        { ruleId: COLLECTOR_UNREACHABLE, entityKey: `collector:${c.id}`, collectorId: c.id, sourceUrl: null, evidence: [`collector:${c.id}@${nowIso}`] },
        !result.ok && failingMs >= opts.collectorUnreachableMinutes * 60_000
          ? { severity: "crit", reason: `Collector ${c.id} cannot reach its source: ${result.error}` }
          : null,
        now,
      );

      await wakeSnoozed(collectorId, now);
    },

    acknowledge: (id, now) => transition(id, ["open"], { state: "acknowledged" }, now),

    async snooze(id, until, now) {
      if (until.getTime() <= now.getTime()) throw new Error("revisit time must be in the future");
      return transition(id, ["open", "acknowledged"], { state: "snoozed", revisitAt: until.toISOString() }, now);
    },

    dismiss: (id, now) => transition(id, ["open", "acknowledged", "snoozed"], { state: "dismissed" }, now),
  };
}
