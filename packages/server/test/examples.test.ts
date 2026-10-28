import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { registry } from "../src/collectors/registry";
import { loadConfig } from "../src/config/load";

const root = new URL("../../../examples/", import.meta.url);
const env = new Proxy({}, { get: (_, name) => (String(name).endsWith("SHA256") ? "0".repeat(64) : "placeholder") });

test.each(readdirSync(root))("example %s/asmodeus.yaml is a valid config", async (dir) => {
  const yaml = await Bun.file(new URL(`${dir}/asmodeus.yaml`, root)).text();
  expect(loadConfig(yaml, env as Record<string, string>, registry).collectors.length).toBeGreaterThan(0);
});
