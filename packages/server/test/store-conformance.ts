import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { NewAttentionItem, Store, StoredObservation } from "../src/store/port";

const obs = (entityKey: string, over: Partial<StoredObservation> = {}): StoredObservation => ({
  entityKey,
  collectorId: "main",
  kind: "monitor",
  status: "ok",
  summary: `${entityKey} is up`,
  attributes: { name: entityKey, nested: { n: 1 } },
  sourceUrl: "http://kuma.local/dashboard",
  observedAt: "2026-10-28T12:00:00.000Z",
  statusSince: "2026-10-28T11:00:00.000Z",
  ...over,
});

const item = (over: Partial<NewAttentionItem> = {}): NewAttentionItem => ({
  ruleId: "fake.down",
  entityKey: "fake:main/a",
  collectorId: "main",
  origin: "rule",
  state: "open",
  severity: "crit",
  attentionReason: "a is down",
  decisionNeeded: null,
  revisitAt: null,
  flapCount: 0,
  evidence: ["fake:main/a@2026-10-28T12:00:00.000Z"],
  sourceUrl: null,
  openedAt: "2026-10-28T12:00:00.000Z",
  updatedAt: "2026-10-28T12:00:00.000Z",
  resolvedAt: null,
  ...over,
});

/** Behaviour every Store adapter must honour (ADR-0007). */
export function describeStoreConformance(name: string, createStore: () => Promise<Store>) {
  describe(`store conformance: ${name}`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await createStore();
    });
    afterEach(async () => {
      await store.close();
    });

    test("observations round-trip, are overwritten per entity and filtered by collector", async () => {
      await store.putObservation(obs("a"));
      await store.putObservation(obs("b", { collectorId: "other" }));
      await store.putObservation(obs("a", { status: "crit", summary: "a is down" }));

      expect(await store.listObservations({ collectorId: "main" })).toEqual([
        obs("a", { status: "crit", summary: "a is down" }),
      ]);
      expect((await store.listObservations()).map((o) => o.entityKey).sort()).toEqual(["a", "b"]);
    });

    test("observations without a source url keep it absent", async () => {
      const { sourceUrl: _, ...noUrl } = obs("a");
      await store.putObservation(noUrl);
      expect((await store.listObservations())[0]).toEqual(noUrl);
    });

    test("observations can be deleted", async () => {
      await store.putObservation(obs("a"));
      await store.putObservation(obs("b"));
      await store.deleteObservations(["a"]);
      await store.deleteObservations([]);
      expect((await store.listObservations()).map((o) => o.entityKey)).toEqual(["b"]);
    });

    test("timestamps are normalised to full ISO form", async () => {
      await store.putObservation(obs("a", { observedAt: "2026-10-28T12:00:00Z" }));
      expect((await store.listObservations())[0]!.observedAt).toBe("2026-10-28T12:00:00.000Z");
    });

    test("transitions are listed newest first since a date, and purged", async () => {
      const t = (at: string, to: "ok" | "crit") => ({ entityKey: "a", collectorId: "main", from: null, to, at });
      await store.appendTransition(t("2026-10-01T00:00:00.000Z", "crit"));
      await store.appendTransition(t("2026-10-27T00:00:00.000Z", "ok"));
      await store.appendTransition(t("2026-10-28T00:00:00.000Z", "crit"));

      expect((await store.listTransitions({ since: "2026-10-26T00:00:00Z" })).map((x) => x.at)).toEqual([
        "2026-10-28T00:00:00.000Z",
        "2026-10-27T00:00:00.000Z",
      ]);
      expect(await store.purgeTransitions("2026-10-27T00:00:00Z")).toBe(1);
      expect(await store.listTransitions({ since: "2000-01-01T00:00:00Z" })).toHaveLength(2);
    });

    test("collector states are upserted", async () => {
      const state = {
        id: "main",
        type: "uptime_kuma",
        ok: true,
        error: null,
        lastAttemptAt: "2026-10-28T12:00:00.000Z",
        lastSuccessAt: "2026-10-28T12:00:00.000Z",
        failingSince: null,
      };
      await store.putCollectorState(state);
      await store.putCollectorState({ ...state, ok: false, error: "HTTP 401", failingSince: "2026-10-28T12:01:00.000Z" });
      expect(await store.listCollectorStates()).toEqual([
        { ...state, ok: false, error: "HTTP 401", failingSince: "2026-10-28T12:01:00.000Z" },
      ]);
    });

    test("attention items get an id, can be read back and patched", async () => {
      const created = await store.insertAttentionItem(item());
      expect(created).toEqual({ ...item(), id: expect.any(String) });
      expect(await store.getAttentionItem(created.id)).toEqual(created);

      const updated = await store.updateAttentionItem(created.id, {
        state: "snoozed",
        revisitAt: "2026-10-29T08:00:00Z",
        updatedAt: "2026-10-28T13:00:00Z",
      });
      expect(updated).toEqual({
        ...created,
        state: "snoozed",
        revisitAt: "2026-10-29T08:00:00.000Z",
        updatedAt: "2026-10-28T13:00:00.000Z",
      });
      expect(await store.getAttentionItem("missing")).toBeNull();
    });

    test("latest attention item per rule and entity is the most recently opened", async () => {
      await store.insertAttentionItem(item({ state: "resolved", openedAt: "2026-10-01T00:00:00Z" }));
      const recent = await store.insertAttentionItem(item({ openedAt: "2026-10-28T00:00:00Z" }));
      await store.insertAttentionItem(item({ entityKey: "fake:main/b", openedAt: "2026-10-29T00:00:00Z" }));

      expect((await store.latestAttentionItem("fake.down", "fake:main/a"))?.id).toBe(recent.id);
      expect(await store.latestAttentionItem("fake.other", "fake:main/a")).toBeNull();
    });

    test("attention items are filtered by state and collector", async () => {
      await store.insertAttentionItem(item({ state: "open" }));
      await store.insertAttentionItem(item({ state: "resolved" }));
      await store.insertAttentionItem(item({ state: "snoozed", collectorId: "other" }));

      expect((await store.listAttentionItems({ states: ["open", "snoozed"] })).map((i) => i.state).sort()).toEqual([
        "open",
        "snoozed",
      ]);
      expect(await store.listAttentionItems({ collectorId: "other" })).toHaveLength(1);
      expect(await store.listAttentionItems()).toHaveLength(3);
    });
  });
}
