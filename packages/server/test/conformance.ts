import { describe, expect, test } from "bun:test";
import { ObservationSchema, type CollectorType } from "@asmodeus/contracts";

export type ConformanceSource = { config: unknown; stop(): Promise<void> };

export type ConformanceSetup = {
  type: CollectorType<any>;
  /** Starts a fake source serving fixtures; returns a valid config pointing at it. */
  start(): Promise<ConformanceSource>;
  /** Same source, but the config carries wrong credentials. */
  startUnauthorized(): Promise<ConformanceSource>;
};

const ID = "conformance";
const now = () => new Date("2026-10-28T12:00:00Z");

function create(type: CollectorType<any>, config: unknown) {
  return type.create(type.configSchema.parse(config), { id: ID, now, fetch });
}

/** Contract every collector type must honour (ADR-0009). */
export function describeCollectorConformance(setup: ConformanceSetup) {
  const { type } = setup;

  describe(`collector conformance: ${type.type}`, () => {
    test("config schema rejects an empty config", () => {
      expect(type.configSchema.safeParse({}).success).toBe(false);
    });

    test("rule ids are namespaced by the type and unique", () => {
      const ids = type.rules.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id.startsWith(`${type.type}.`)).toBe(true);
    });

    test("every rule accepts empty params and fills defaults", () => {
      for (const rule of type.rules) expect(rule.paramsSchema.safeParse({}).success).toBe(true);
    });

    test("healthy source: valid, unique, namespaced and stable observations", async () => {
      const source = await setup.start();
      try {
        const collector = create(type, source.config);
        expect(await collector.health()).toMatchObject({ ok: true });

        const first = await collector.collect();
        if (!first.ok) throw new Error(`collect failed: ${first.error}`);
        expect(first.observations.length).toBeGreaterThan(0);

        for (const o of first.observations) {
          expect(ObservationSchema.safeParse(o).error).toBeUndefined();
          expect(o.entityKey.startsWith(`${type.type}:${ID}/`)).toBe(true);
        }
        const keys = first.observations.map((o) => o.entityKey);
        expect(new Set(keys).size).toBe(keys.length);

        const second = await collector.collect();
        if (!second.ok) throw new Error(`collect failed: ${second.error}`);
        expect(second.observations.map((o) => o.entityKey).sort()).toEqual([...keys].sort());

        expect(Array.isArray(collector.tools())).toBe(true);
      } finally {
        await source.stop();
      }
    });

    test("wrong credentials: unhealthy and a failed collect, never a throw", async () => {
      const source = await setup.startUnauthorized();
      try {
        const collector = create(type, source.config);
        const health = await collector.health();
        expect(health.ok).toBe(false);
        expect(health.message).toBeTruthy();
        const result = await collector.collect();
        expect(result.ok).toBe(false);
      } finally {
        await source.stop();
      }
    });

    test("unreachable source: unhealthy and a failed collect, never a throw", async () => {
      const source = await setup.start();
      await source.stop();
      const collector = create(type, source.config);
      expect((await collector.health()).ok).toBe(false);
      const result = await collector.collect();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeTruthy();
    });
  });
}
