import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { CollectorType } from "@asmodeus/contracts";
import { ConfigError, loadConfig } from "../src/config/load";

const fakeType: CollectorType<{ baseUrl: string; apiKey: string }> = {
  type: "fake",
  configSchema: z.object({ baseUrl: z.url(), apiKey: z.string().min(1) }),
  rules: [
    {
      id: "fake.down",
      description: "",
      paramsSchema: z.object({ forMinutes: z.number().default(5) }),
      evaluate: () => null,
    },
  ],
  create: () => {
    throw new Error("not used");
  },
};
const registry = [fakeType];

const minimal = `
server:
  host: 127.0.0.1
auth:
  mode: none
collectors:
  - id: main
    type: fake
    config:
      baseUrl: http://kuma.local
      apiKey: \${KUMA_KEY}
`;

describe("loadConfig", () => {
  test("loads a minimal config, interpolates env and fills defaults", () => {
    const config = loadConfig(minimal, { KUMA_KEY: "s3cret" }, registry);

    expect(config.server).toEqual({ host: "127.0.0.1", port: 8080 });
    expect(config.dataDir).toBe("./data");
    expect(config.attention.flapWindowMinutes).toBe(60);
    expect(config.retention.transitionsDays).toBe(90);
    expect(config.collectors).toEqual([
      {
        id: "main",
        type: "fake",
        intervalSeconds: 60,
        config: { baseUrl: "http://kuma.local", apiKey: "s3cret" },
        rules: { "fake.down": { enabled: true, params: { forMinutes: 5 } } },
      },
    ]);
  });

  test("rule thresholds can be overridden and rules disabled", () => {
    const yaml = minimal + `    rules:\n      fake.down:\n        params:\n          forMinutes: 15\n`;
    const config = loadConfig(yaml, { KUMA_KEY: "x" }, registry);
    expect(config.collectors[0]!.rules["fake.down"]).toEqual({ enabled: true, params: { forMinutes: 15 } });

    const disabled = minimal + `    rules:\n      fake.down:\n        enabled: false\n`;
    expect(loadConfig(disabled, { KUMA_KEY: "x" }, registry).collectors[0]!.rules["fake.down"]!.enabled).toBe(false);
  });

  test("a missing env variable is reported with its path", () => {
    expect(() => loadConfig(minimal, {}, registry)).toThrow(ConfigError);
    expect(() => loadConfig(minimal, {}, registry)).toThrow(/collectors\.0\.config\.apiKey.*KUMA_KEY/);
  });

  test("env values are not re-parsed as YAML", () => {
    const config = loadConfig(minimal, { KUMA_KEY: "a: [b" }, registry);
    expect(config.collectors[0]!.config).toEqual({ baseUrl: "http://kuma.local", apiKey: "a: [b" });
  });

  test("auth none is refused unless bound to localhost", () => {
    const exposed = minimal.replace("host: 127.0.0.1", "host: 0.0.0.0");
    expect(() => loadConfig(exposed, { KUMA_KEY: "x" }, registry)).toThrow(/auth\.mode none.*127\.0\.0\.1/);
  });

  test("token auth requires sha256 hashes and scopes", () => {
    const yaml = minimal
      .replace("host: 127.0.0.1", "host: 0.0.0.0")
      .replace("mode: none", `mode: tokens\n  tokens:\n    - name: n8n\n      sha256: ${"a".repeat(64)}\n      scopes: [overview:read]`);
    const config = loadConfig(yaml, { KUMA_KEY: "x" }, registry);
    expect(config.auth).toEqual({
      mode: "tokens",
      tokens: [{ name: "n8n", sha256: "a".repeat(64), scopes: ["overview:read"] }],
    });

    expect(() => loadConfig(yaml.replace("a".repeat(64), "plaintext"), { KUMA_KEY: "x" }, registry)).toThrow(ConfigError);
  });

  test("an unknown collector type is rejected", () => {
    expect(() => loadConfig(minimal.replace("type: fake", "type: nope"), { KUMA_KEY: "x" }, registry)).toThrow(
      /collectors\.0\.type.*unknown collector type "nope"/,
    );
  });

  test("a collector config is validated against its type schema", () => {
    expect(() =>
      loadConfig(minimal.replace("http://kuma.local", "not a url"), { KUMA_KEY: "x" }, registry),
    ).toThrow(/collectors\.0\.config\.baseUrl/);
  });

  test("an unknown rule id is rejected", () => {
    const yaml = minimal + `    rules:\n      fake.typo:\n        enabled: false\n`;
    expect(() => loadConfig(yaml, { KUMA_KEY: "x" }, registry)).toThrow(/unknown rule "fake\.typo"/);
  });

  test("collector ids must be unique", () => {
    const yaml = minimal + `  - id: main\n    type: fake\n    config:\n      baseUrl: http://b.local\n      apiKey: k\n`;
    expect(() => loadConfig(yaml, { KUMA_KEY: "x" }, registry)).toThrow(/duplicate collector id "main"/);
  });

  test("invalid YAML is a ConfigError", () => {
    expect(() => loadConfig("server: [", {}, registry)).toThrow(ConfigError);
  });
});
