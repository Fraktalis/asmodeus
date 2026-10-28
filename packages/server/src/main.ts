import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { registry } from "./collectors/registry";
import { ConfigError, loadConfig } from "./config/load";
import { createEngine } from "./engine";
import { createApp } from "./http/app";
import { startScheduler } from "./scheduler";
import { openSqliteStore } from "./store/sqlite";

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

const configPath = process.env.ASMODEUS_CONFIG ?? "./asmodeus.yaml";
let config;
try {
  config = loadConfig(await Bun.file(configPath).text(), process.env, registry);
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : `Cannot read ${configPath}: ${(e as Error).message}`);
  process.exit(1);
}

mkdirSync(config.dataDir, { recursive: true });
const store = openSqliteStore(join(config.dataDir, "asmodeus.sqlite"));
const types = new Map(registry.map((t) => [t.type, t]));

const collectors = config.collectors.map((c) => ({ ...c, type: types.get(c.type)! }));
const engine = createEngine({
  store,
  collectors,
  flapWindowMinutes: config.attention.flapWindowMinutes,
  collectorUnreachableMinutes: config.attention.collectorUnreachableMinutes,
  log,
});

const instances = collectors.map((c) => ({
  id: c.id,
  intervalSeconds: c.intervalSeconds,
  collector: c.type.create(c.config, { id: c.id, now: () => new Date(), fetch }),
}));

for (const { id, collector } of instances) {
  const health = await collector.health();
  log(`collector ${id}: ${health.ok ? "healthy" : `unhealthy: ${health.message}`}`);
}

const scheduler = startScheduler({ engine, store, collectors: instances, retentionDays: config.retention.transitionsDays, log });
const app = createApp({ store, auth: config.auth, collectors });
const server = Bun.serve({ hostname: config.server.host, port: config.server.port, fetch: app.fetch });
log(`asmodeus listening on http://${server.hostname}:${server.port} (auth: ${config.auth.mode})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    scheduler.stop();
    await server.stop();
    await store.close();
    process.exit(0);
  });
}
