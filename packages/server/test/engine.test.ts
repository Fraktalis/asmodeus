import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import type { CollectResult, CollectorType, Observation, Status } from "@asmodeus/contracts";
import { createEngine, type Engine } from "../src/engine";
import { openSqliteStore } from "../src/store/sqlite";
import type { Store } from "../src/store/port";

const fakeType: CollectorType<{}> = {
  type: "fake",
  configSchema: z.object({}),
  rules: [
    {
      id: "fake.down",
      description: "crit for at least forMinutes",
      paramsSchema: z.object({ forMinutes: z.number().default(5) }),
      evaluate: ({ observation, statusSince }, now, { forMinutes }) =>
        observation.status === "crit" && now.getTime() - Date.parse(statusSince) >= forMinutes * 60_000
          ? { severity: "crit", reason: `${observation.entityKey} down` }
          : null,
    },
    {
      id: "fake.degraded",
      description: "warn => warn, crit => crit",
      paramsSchema: z.object({}),
      evaluate: ({ observation }) =>
        observation.status === "warn" || observation.status === "crit"
          ? { severity: observation.status, reason: `${observation.entityKey} degraded` }
          : null,
    },
    {
      id: "fake.broken",
      description: "always throws",
      paramsSchema: z.object({}),
      evaluate: () => {
        throw new Error("boom");
      },
    },
  ],
  create: () => {
    throw new Error("not used");
  },
};

const rules = (over: Record<string, { enabled?: boolean; params?: unknown }> = {}) => ({
  "fake.down": { enabled: true, params: { forMinutes: 5 }, ...over["fake.down"] },
  "fake.degraded": { enabled: false, params: {}, ...over["fake.degraded"] },
  "fake.broken": { enabled: true, params: {}, ...over["fake.broken"] },
});

const T0 = Date.parse("2026-10-28T12:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

const obs = (name: string, status: Status, minute: number): Observation => ({
  entityKey: `fake:main/${name}`,
  kind: "thing",
  status,
  summary: `${name} ${status}`,
  attributes: {},
  sourceUrl: "http://fake.local/" + name,
  observedAt: at(minute).toISOString(),
});
const ok = (...observations: Observation[]): CollectResult => ({ ok: true, observations });
const failed: CollectResult = { ok: false, error: "HTTP 503" };

let store: Store;
let engine: Engine;

function setup(ruleOverrides?: Parameters<typeof rules>[0]) {
  engine = createEngine({
    store,
    collectors: [{ id: "main", type: fakeType, rules: rules(ruleOverrides) }],
    flapWindowMinutes: 60,
    collectorUnreachableMinutes: 5,
  });
}

beforeEach(() => {
  store = openSqliteStore(":memory:");
  setup();
});

const active = () => store.listAttentionItems({ states: ["open", "acknowledged", "snoozed", "dismissed"] });

describe("ingest: observations and transitions", () => {
  test("stores the latest observation with the time it entered its status", async () => {
    await engine.ingest("main", ok(obs("a", "ok", 0)), at(0));
    await engine.ingest("main", ok(obs("a", "ok", 1)), at(1));
    await engine.ingest("main", ok(obs("a", "crit", 2)), at(2));
    await engine.ingest("main", ok(obs("a", "crit", 3)), at(3));

    const [a] = await store.listObservations();
    expect(a).toMatchObject({ status: "crit", observedAt: at(3).toISOString(), statusSince: at(2).toISOString() });
  });

  test("records a transition only when the status changes", async () => {
    await engine.ingest("main", ok(obs("a", "ok", 0)), at(0));
    await engine.ingest("main", ok(obs("a", "ok", 1)), at(1));
    await engine.ingest("main", ok(obs("a", "crit", 2)), at(2));

    const transitions = await store.listTransitions({ since: at(-1).toISOString() });
    expect(transitions.map((t) => [t.from, t.to])).toEqual([
      ["ok", "crit"],
      [null, "ok"],
    ]);
  });

  test("entities missing from a successful collect are removed", async () => {
    await engine.ingest("main", ok(obs("a", "ok", 0), obs("b", "ok", 0)), at(0));
    await engine.ingest("main", ok(obs("a", "ok", 1)), at(1));
    expect((await store.listObservations()).map((o) => o.entityKey)).toEqual(["fake:main/a"]);
  });

  test("a failed collect keeps the last known entities and records the failure", async () => {
    await engine.ingest("main", ok(obs("a", "ok", 0)), at(0));
    await engine.ingest("main", failed, at(1));

    expect(await store.listObservations()).toHaveLength(1);
    expect(await store.listCollectorStates()).toEqual([
      {
        id: "main",
        type: "fake",
        ok: false,
        error: "HTTP 503",
        lastAttemptAt: at(1).toISOString(),
        lastSuccessAt: at(0).toISOString(),
        failingSince: at(1).toISOString(),
      },
    ]);
  });
});

describe("ingest: attention items", () => {
  test("a rule fires only once its condition has held long enough", async () => {
    await engine.ingest("main", ok(obs("a", "crit", 0)), at(0));
    expect(await active()).toHaveLength(0);

    await engine.ingest("main", ok(obs("a", "crit", 5)), at(5));
    expect(await active()).toEqual([
      expect.objectContaining({
        ruleId: "fake.down",
        entityKey: "fake:main/a",
        collectorId: "main",
        origin: "rule",
        state: "open",
        severity: "crit",
        attentionReason: "fake:main/a down",
        sourceUrl: "http://fake.local/a",
        flapCount: 0,
        openedAt: at(5).toISOString(),
      }),
    ]);
  });

  test("the same condition is deduplicated into one item", async () => {
    for (const m of [0, 5, 6, 7]) await engine.ingest("main", ok(obs("a", "crit", m)), at(m));
    expect(await store.listAttentionItems()).toHaveLength(1);
  });

  test("an item resolves automatically when its condition clears", async () => {
    await engine.ingest("main", ok(obs("a", "crit", 0)), at(0));
    await engine.ingest("main", ok(obs("a", "crit", 5)), at(5));
    await engine.ingest("main", ok(obs("a", "ok", 6)), at(6));

    const [item] = await store.listAttentionItems();
    expect(item).toMatchObject({ state: "resolved", resolvedAt: at(6).toISOString() });
  });

  test("an item resolves when its entity disappears", async () => {
    await engine.ingest("main", ok(obs("a", "crit", 0)), at(0));
    await engine.ingest("main", ok(obs("a", "crit", 5)), at(5));
    await engine.ingest("main", ok(), at(6));
    expect(await active()).toHaveLength(0);
  });

  test("reopening within the flap window counts flapping on the same item", async () => {
    await engine.ingest("main", ok(obs("a", "crit", 0)), at(0));
    await engine.ingest("main", ok(obs("a", "crit", 5)), at(5));
    await engine.ingest("main", ok(obs("a", "ok", 6)), at(6));
    await engine.ingest("main", ok(obs("a", "crit", 10)), at(10));
    await engine.ingest("main", ok(obs("a", "crit", 15)), at(15));

    const items = await store.listAttentionItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ state: "open", flapCount: 1, resolvedAt: null });
  });

  test("firing again after the flap window opens a new item", async () => {
    await engine.ingest("main", ok(obs("a", "crit", 0)), at(0));
    await engine.ingest("main", ok(obs("a", "crit", 5)), at(5));
    await engine.ingest("main", ok(obs("a", "ok", 6)), at(6));
    await engine.ingest("main", ok(obs("a", "crit", 100)), at(100));
    await engine.ingest("main", ok(obs("a", "crit", 105)), at(105));

    const items = await store.listAttentionItems();
    expect(items.map((i) => [i.state, i.flapCount])).toEqual([
      ["open", 0],
      ["resolved", 0],
    ]);
  });

  test("a failed collect neither resolves nor creates entity items", async () => {
    await engine.ingest("main", ok(obs("a", "crit", 0)), at(0));
    await engine.ingest("main", ok(obs("a", "crit", 5)), at(5));
    await engine.ingest("main", failed, at(6));
    expect((await active()).filter((i) => i.ruleId === "fake.down")).toHaveLength(1);
  });

  test("disabled rules never fire and params come from config", async () => {
    setup({ "fake.down": { enabled: false } });
    await engine.ingest("main", ok(obs("a", "crit", 0)), at(0));
    await engine.ingest("main", ok(obs("a", "crit", 30)), at(30));
    expect(await active()).toHaveLength(0);

    store = openSqliteStore(":memory:");
    setup({ "fake.down": { params: { forMinutes: 20 } } });
    await engine.ingest("main", ok(obs("a", "crit", 0)), at(0));
    await engine.ingest("main", ok(obs("a", "crit", 10)), at(10));
    expect(await active()).toHaveLength(0);
    await engine.ingest("main", ok(obs("a", "crit", 20)), at(20));
    expect(await active()).toHaveLength(1);
  });

  test("a throwing rule does not stop the others", async () => {
    await engine.ingest("main", ok(obs("a", "crit", 0)), at(0));
    await engine.ingest("main", ok(obs("a", "crit", 5)), at(5));
    expect(await active()).toHaveLength(1);
  });

  test("severity follows the finding and escalation reopens an acknowledged item", async () => {
    setup({ "fake.down": { enabled: false }, "fake.degraded": { enabled: true } });
    await engine.ingest("main", ok(obs("a", "warn", 0)), at(0));
    const [item] = await active();
    await engine.acknowledge(item!.id, at(1));

    await engine.ingest("main", ok(obs("a", "warn", 2)), at(2));
    expect(await store.getAttentionItem(item!.id)).toMatchObject({ state: "acknowledged", severity: "warn" });

    await engine.ingest("main", ok(obs("a", "crit", 3)), at(3));
    expect(await store.getAttentionItem(item!.id)).toMatchObject({ state: "open", severity: "crit" });
  });
});

describe("collector unreachable", () => {
  test("opens a core item after the threshold and resolves it on recovery", async () => {
    await engine.ingest("main", failed, at(0));
    await engine.ingest("main", failed, at(4));
    expect(await active()).toHaveLength(0);

    await engine.ingest("main", failed, at(5));
    expect(await active()).toEqual([
      expect.objectContaining({
        ruleId: "core.collector_unreachable",
        entityKey: "collector:main",
        severity: "crit",
        attentionReason: expect.stringContaining("HTTP 503"),
      }),
    ]);

    await engine.ingest("main", ok(), at(6));
    expect(await active()).toHaveLength(0);
  });
});

describe("human actions", () => {
  async function openItem() {
    await engine.ingest("main", ok(obs("a", "crit", 0)), at(0));
    await engine.ingest("main", ok(obs("a", "crit", 5)), at(5));
    return (await active())[0]!;
  }

  test("acknowledged items stay acknowledged while the condition holds", async () => {
    const item = await openItem();
    await engine.acknowledge(item.id, at(6));
    await engine.ingest("main", ok(obs("a", "crit", 7)), at(7));
    expect(await store.getAttentionItem(item.id)).toMatchObject({ state: "acknowledged" });
  });

  test("a snoozed item comes back at its revisit time", async () => {
    const item = await openItem();
    await engine.snooze(item.id, at(30), at(6));
    await engine.ingest("main", ok(obs("a", "crit", 20)), at(20));
    expect(await store.getAttentionItem(item.id)).toMatchObject({ state: "snoozed", revisitAt: at(30).toISOString() });

    await engine.ingest("main", ok(obs("a", "crit", 30)), at(30));
    expect(await store.getAttentionItem(item.id)).toMatchObject({ state: "open", revisitAt: null });
  });

  test("a dismissed item stays dismissed while the condition holds", async () => {
    const item = await openItem();
    await engine.dismiss(item.id, at(6));
    await engine.ingest("main", ok(obs("a", "crit", 7)), at(7));
    expect(await store.getAttentionItem(item.id)).toMatchObject({ state: "dismissed" });
  });

  test("actions are refused on resolved or unknown items", async () => {
    const item = await openItem();
    await engine.ingest("main", ok(obs("a", "ok", 6)), at(6));
    await expect(engine.acknowledge(item.id, at(7))).rejects.toThrow(/resolved/);
    await expect(engine.dismiss("nope", at(7))).rejects.toThrow(/not found/);
  });

  test("snoozing requires a revisit time in the future", async () => {
    const item = await openItem();
    await expect(engine.snooze(item.id, at(5), at(6))).rejects.toThrow(/future/);
  });
});
