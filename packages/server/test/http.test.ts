import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { OverviewSchema, type CollectorType, type Observation } from "@asmodeus/contracts";
import { createApp } from "../src/http/app";
import { createEngine, type Engine } from "../src/engine";
import { openSqliteStore } from "../src/store/sqlite";
import { hashToken } from "../src/auth/tokens";
import type { Store } from "../src/store/port";
import type { AuthConfig } from "../src/config/load";

const fakeType: CollectorType<{}> = {
  type: "fake",
  configSchema: z.object({}),
  rules: [
    {
      id: "fake.bad",
      description: "",
      paramsSchema: z.object({}),
      evaluate: ({ observation: o }) =>
        o.status === "warn" || o.status === "crit" ? { severity: o.status, reason: `${o.entityKey} is ${o.status}` } : null,
    },
  ],
  create: () => {
    throw new Error("not used");
  },
};

const TOKEN = "asm_test_token";
const tokenAuth: AuthConfig = {
  mode: "tokens",
  tokens: [{ name: "test", sha256: hashToken(TOKEN), scopes: ["overview:read"] }],
};

const T0 = Date.parse("2026-10-28T12:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000);
const obs = (name: string, status: Observation["status"]): Observation => ({
  entityKey: `fake:${name}`,
  kind: "thing",
  status,
  summary: name,
  attributes: {},
  observedAt: at(0).toISOString(),
});

let store: Store;
let engine: Engine;
let now: Date;

const collectors = [
  { id: "main", type: fakeType, intervalSeconds: 60, rules: { "fake.bad": { enabled: true, params: {} } } },
  { id: "never", type: fakeType, intervalSeconds: 60, rules: { "fake.bad": { enabled: true, params: {} } } },
];

function app(auth: AuthConfig = tokenAuth) {
  return createApp({ store, auth, collectors, now: () => now });
}

const get = (path: string, token?: string, auth?: AuthConfig) =>
  app(auth).fetch(
    new Request(`http://asmodeus.local${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  );

beforeEach(() => {
  store = openSqliteStore(":memory:");
  engine = createEngine({ store, collectors, flapWindowMinutes: 60, collectorUnreachableMinutes: 5, log: () => {} });
  now = at(0);
});

describe("auth", () => {
  test("overview requires a bearer token", async () => {
    expect((await get("/api/overview")).status).toBe(401);
    expect((await get("/api/overview", "wrong")).status).toBe(401);
    expect((await get("/api/overview", TOKEN)).status).toBe(200);
  });

  test("a token without the scope is forbidden", async () => {
    const auth: AuthConfig = { mode: "tokens", tokens: [{ name: "x", sha256: hashToken("other"), scopes: [] as never }] };
    expect((await get("/api/overview", "other", auth)).status).toBe(403);
  });

  test("auth mode none serves without token", async () => {
    expect((await get("/api/overview", undefined, { mode: "none" })).status).toBe(200);
  });

  test("liveness needs no token", async () => {
    const res = await get("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("unknown routes are 404", async () => {
    expect((await get("/nope", TOKEN)).status).toBe(404);
  });
});

describe("GET /api/overview", () => {
  async function overview() {
    const res = await get("/api/overview", TOKEN);
    return OverviewSchema.parse(await res.json());
  }

  test("is valid against the contract when empty", async () => {
    expect(await overview()).toEqual({
      generatedAt: at(0).toISOString(),
      attention: [],
      collectors: [
        expect.objectContaining({ id: "main", type: "fake", ok: false, lastSuccessAt: null, stale: true }),
        expect.objectContaining({ id: "never", stale: true }),
      ],
      pulse: [],
    });
  });

  test("lists exceptions first: open before acknowledged, crit before warn, oldest first", async () => {
    await engine.ingest("main", { ok: true, observations: [obs("w", "warn")] }, at(0));
    await engine.ingest("main", { ok: true, observations: [obs("w", "warn"), obs("c1", "crit")] }, at(1));
    await engine.ingest("main", { ok: true, observations: [obs("w", "warn"), obs("c1", "crit"), obs("c2", "crit")] }, at(2));
    await engine.ingest(
      "main",
      { ok: true, observations: [obs("w", "warn"), obs("c1", "crit"), obs("c2", "crit"), obs("fine", "ok")] },
      at(3),
    );
    const c2 = (await store.listAttentionItems()).find((i) => i.entityKey === "fake:c2")!;
    await engine.acknowledge(c2.id, at(3));
    now = at(4);

    expect((await overview()).attention.map((i) => [i.entityKey, i.state])).toEqual([
      ["fake:c1", "open"],
      ["fake:w", "open"],
      ["fake:c2", "acknowledged"],
    ]);
  });

  test("hides snoozed, dismissed and resolved items", async () => {
    await engine.ingest("main", { ok: true, observations: [obs("a", "crit"), obs("b", "crit"), obs("c", "crit")] }, at(0));
    const [a, b] = await store.listAttentionItems();
    await engine.snooze(a!.id, at(60), at(1));
    await engine.dismiss(b!.id, at(1));
    await engine.ingest("main", { ok: true, observations: [obs("a", "crit"), obs("b", "crit"), obs("c", "ok")] }, at(2));

    expect((await overview()).attention).toEqual([]);
  });

  test("summarises each collector: health, entity counts and staleness", async () => {
    await engine.ingest("main", { ok: true, observations: [obs("a", "ok"), obs("b", "crit"), obs("c", "ok")] }, at(0));
    now = at(1);
    let main = (await overview()).collectors.find((c) => c.id === "main")!;
    expect(main).toEqual({
      id: "main",
      type: "fake",
      ok: true,
      error: null,
      lastAttemptAt: at(0).toISOString(),
      lastSuccessAt: at(0).toISOString(),
      stale: false,
      entities: { ok: 2, warn: 0, crit: 1, unknown: 0 },
    });

    await engine.ingest("main", { ok: false, error: "HTTP 503" }, at(2));
    now = at(4);
    main = (await overview()).collectors.find((c) => c.id === "main")!;
    expect(main).toMatchObject({ ok: false, error: "HTTP 503", stale: true });
  });

  test("pulse lists the last 24 hours of transitions, newest first", async () => {
    await engine.ingest("main", { ok: true, observations: [obs("a", "ok")] }, at(0));
    await engine.ingest("main", { ok: true, observations: [obs("a", "crit")] }, at(60 * 20));
    now = at(60 * 25);

    expect((await overview()).pulse).toEqual([
      { entityKey: "fake:a", collectorId: "main", from: "ok", to: "crit", at: at(60 * 20).toISOString() },
    ]);
  });
});
