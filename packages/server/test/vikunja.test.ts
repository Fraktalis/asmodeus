import { describe, expect, test } from "bun:test";
import { serveMocks, vikunja } from "@asmodeus/mocks";
import type { Observation } from "@asmodeus/contracts";
import { vikunjaType } from "../src/collectors/vikunja";
import { describeCollectorConformance } from "./conformance";

const TOKEN = "tk_test";

describeCollectorConformance({
  type: vikunjaType,
  async start() {
    const s = serveMocks([vikunja({ apiToken: TOKEN })]);
    return { config: { baseUrl: s.url, apiToken: TOKEN }, stop: s.stop };
  },
  async startUnauthorized() {
    const s = serveMocks([vikunja({ apiToken: TOKEN })]);
    return { config: { baseUrl: s.url, apiToken: "wrong" }, stop: s.stop };
  },
});

const NOW = new Date("2026-10-28T12:00:00Z");

async function collect(config: Record<string, unknown> = {}) {
  const s = serveMocks([vikunja({ apiToken: TOKEN })]);
  try {
    const collector = vikunjaType.create(vikunjaType.configSchema.parse({ baseUrl: s.url, apiToken: TOKEN, ...config }), {
      id: "tasks",
      now: () => NOW,
      fetch,
    });
    const result = await collector.collect();
    if (!result.ok) throw new Error(result.error);
    return { observations: result.observations, baseUrl: s.url };
  } finally {
    await s.stop();
  }
}

describe("vikunja collector", () => {
  test("reports every open task across pages, never done ones", async () => {
    const { observations } = await collect({ pageSize: 2 });
    expect(observations.map((o) => o.attributes.taskId).sort()).toEqual([101, 102, 103, 104, 201, 202]);
  });

  test("can be limited to some projects", async () => {
    const { observations } = await collect({ projectIds: [13, 5] });
    expect(observations.map((o) => o.attributes.taskId).sort()).toEqual([201, 202]);
  });

  test("an overdue task is warn, others ok; unset dates are null", async () => {
    const { observations, baseUrl } = await collect();
    const byId = Object.fromEntries(observations.map((o) => [o.attributes.taskId as number, o]));
    expect(byId[101]).toMatchObject({
      entityKey: "vikunja:tasks/task/101",
      kind: "task",
      status: "warn",
      summary: "INFRA-1 Renew TLS certificate for the docs site",
      sourceUrl: `${baseUrl}/tasks/101`,
      attributes: { title: "Renew TLS certificate for the docs site", projectId: 6, priority: 4, dueDate: "2026-10-25T18:00:00.000Z" },
    });
    expect(byId[102]!.status).toBe("ok");
    expect(byId[104]!.attributes.dueDate).toBeNull();
    expect(byId[201]!.summary).toBe("Book the venue");
  });
});

describe("vikunja rules", () => {
  const rule = (id: string) => vikunjaType.rules.find((r) => r.id === id)!;
  const task = (attributes: Record<string, unknown>): Observation => ({
    entityKey: "vikunja:tasks/task/1",
    kind: "task",
    status: "ok",
    summary: "T",
    attributes: { title: "T", priority: 2, dueDate: null, updated: "2026-10-27T00:00:00Z", ...attributes },
    observedAt: NOW.toISOString(),
  });
  const evaluate = (id: string, attributes: Record<string, unknown>, params = {}) =>
    rule(id).evaluate({ observation: task(attributes), statusSince: "" }, NOW, rule(id).paramsSchema.parse(params));

  test("task_overdue: warn when past due, crit for high priority, nothing otherwise", () => {
    expect(evaluate("vikunja.task_overdue", { dueDate: "2026-10-27T00:00:00Z" })).toMatchObject({
      severity: "warn",
      decisionNeeded: expect.any(String),
    });
    expect(evaluate("vikunja.task_overdue", { dueDate: "2026-10-27T00:00:00Z", priority: 4 })).toMatchObject({ severity: "crit" });
    expect(evaluate("vikunja.task_overdue", { dueDate: "2026-10-29T00:00:00Z" })).toBeNull();
    expect(evaluate("vikunja.task_overdue", { dueDate: null })).toBeNull();
    expect(evaluate("vikunja.task_overdue", { dueDate: "2026-10-28T06:00:00Z" }, { graceHours: 12 })).toBeNull();
  });

  test("urgent_stale: a high-priority task untouched for too long", () => {
    expect(evaluate("vikunja.urgent_stale", { priority: 4, updated: "2026-10-01T00:00:00Z" })).toMatchObject({ severity: "warn" });
    expect(evaluate("vikunja.urgent_stale", { priority: 4, updated: "2026-10-25T00:00:00Z" })).toBeNull();
    expect(evaluate("vikunja.urgent_stale", { priority: 2, updated: "2026-10-01T00:00:00Z" })).toBeNull();
  });
});
