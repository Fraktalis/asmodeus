// Phase 1 acceptance (S6): waits until /api/overview returns a valid snapshot with healthy
// collectors and at least one rule-derived attention item.
//   bun scripts/smoke.ts [baseUrl] [token]
import { OverviewSchema } from "@asmodeus/contracts";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8080";
const token = process.argv[3] ?? process.env.ASMODEUS_TOKEN ?? "asm_dev_token_not_secret";
const deadline = Date.now() + Number(process.env.SMOKE_TIMEOUT_MS ?? 90_000);
let last = "no response yet";

while (Date.now() < deadline) {
  try {
    const res = await fetch(`${baseUrl}/api/overview`, { headers: { authorization: `Bearer ${token}` } });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const overview = OverviewSchema.parse(await res.json());
    const unhealthy = overview.collectors.filter((c) => !c.ok);
    if (unhealthy.length) throw new Error(`unhealthy collectors: ${unhealthy.map((c) => `${c.id} (${c.error})`).join(", ")}`);
    if (!overview.attention.some((i) => i.origin === "rule")) throw new Error("no attention item yet");

    console.log(`smoke OK: ${overview.collectors.length} collectors, ${overview.attention.length} attention items`);
    for (const i of overview.attention) console.log(`  [${i.severity}] ${i.ruleId} ${i.attentionReason}`);
    process.exit(0);
  } catch (e) {
    last = (e as Error).message;
  }
  await Bun.sleep(2000);
}
console.error(`smoke FAILED: ${last}`);
process.exit(1);
