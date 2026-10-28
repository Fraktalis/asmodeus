import { describe, expect, test } from "bun:test";
import { serveMocks, uptimeKuma } from "@asmodeus/mocks";
import type { Observation } from "@asmodeus/contracts";
import { uptimeKumaType } from "../src/collectors/uptime-kuma";
import { describeCollectorConformance } from "./conformance";

const API_KEY = "uk1_test";

describeCollectorConformance({
  type: uptimeKumaType,
  async start() {
    const s = serveMocks([uptimeKuma({ apiKey: API_KEY })]);
    return { config: { baseUrl: s.url, apiKey: API_KEY }, stop: s.stop };
  },
  async startUnauthorized() {
    const s = serveMocks([uptimeKuma({ apiKey: API_KEY })]);
    return { config: { baseUrl: s.url, apiKey: "wrong" }, stop: s.stop };
  },
});

describe("uptime_kuma collector", () => {
  async function collectFixture() {
    const s = serveMocks([uptimeKuma({ apiKey: API_KEY })]);
    try {
      const collector = uptimeKumaType.create(
        uptimeKumaType.configSchema.parse({ baseUrl: s.url, apiKey: API_KEY }),
        { id: "main", now: () => new Date("2026-10-28T12:00:00Z"), fetch },
      );
      const result = await collector.collect();
      if (!result.ok) throw new Error(result.error);
      return Object.fromEntries(result.observations.map((o) => [o.attributes.name as string, o]));
    } finally {
      await s.stop();
    }
  }

  test("maps monitor status: UP ok, DOWN crit, PENDING warn, MAINTENANCE ok", async () => {
    const byName = await collectFixture();
    expect(byName["Tasks"]!.status).toBe("ok");
    expect(byName["Home Assistant"]!.status).toBe("crit");
    expect(byName["Git forge"]!.status).toBe("warn");
    expect(byName["Media server"]!.status).toBe("ok");
    expect(byName["Media server"]!.attributes.maintenance).toBe(true);
  });

  test("keeps per-monitor details as attributes", async () => {
    const byName = await collectFixture();
    expect(byName["Paperless"]).toMatchObject({
      kind: "monitor",
      entityKey: "uptime_kuma:main/Paperless",
      observedAt: "2026-10-28T12:00:00.000Z",
      attributes: { monitorType: "http", target: "https://docs.example.com", responseTimeMs: 140, certDaysRemaining: 5 },
    });
    expect(byName["Git forge"]!.attributes.target).toBe("192.168.1.11:22");
  });

  test("handles escaped quotes in monitor names", async () => {
    const byName = await collectFixture();
    expect(byName['NAS "main" ping']!.entityKey).toBe("uptime_kuma:main/NAS%20%22main%22%20ping");
  });

  test("works without an API key when metrics auth is disabled", () => {
    expect(uptimeKumaType.configSchema.safeParse({ baseUrl: "http://kuma.local" }).success).toBe(true);
  });
});

describe("uptime_kuma rules", () => {
  const rule = (id: string) => uptimeKumaType.rules.find((r) => r.id === id)!;
  const monitor = (status: Observation["status"], attributes: Record<string, unknown> = {}): Observation => ({
    entityKey: "uptime_kuma:main/Tasks",
    kind: "monitor",
    status,
    summary: "",
    attributes: { name: "Tasks", ...attributes },
    observedAt: "2026-10-28T12:00:00Z",
  });
  const now = new Date("2026-10-28T12:00:00Z");

  test("monitor_down fires once a monitor has been down for the threshold", () => {
    const down = rule("uptime_kuma.monitor_down");
    const params = down.paramsSchema.parse({});
    expect(down.evaluate({ observation: monitor("crit"), statusSince: "2026-10-28T11:57:00Z" }, now, params)).toBeNull();
    expect(
      down.evaluate({ observation: monitor("crit"), statusSince: "2026-10-28T11:55:00Z" }, now, params),
    ).toMatchObject({ severity: "crit", reason: expect.stringContaining("Tasks") });
    expect(down.evaluate({ observation: monitor("ok"), statusSince: "2026-10-27T00:00:00Z" }, now, params)).toBeNull();
  });

  test("cert_expiring warns below the threshold, crit below the critical threshold", () => {
    const cert = rule("uptime_kuma.cert_expiring");
    const params = cert.paramsSchema.parse({});
    const at = (days: number) =>
      cert.evaluate({ observation: monitor("ok", { certDaysRemaining: days }), statusSince: "" }, now, params);
    expect(at(30)).toBeNull();
    expect(at(10)).toMatchObject({ severity: "warn" });
    expect(at(2)).toMatchObject({ severity: "crit" });
    expect(cert.evaluate({ observation: monitor("ok"), statusSince: "" }, now, params)).toBeNull();
  });
});
