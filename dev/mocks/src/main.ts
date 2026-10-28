// Fake Uptime Kuma and Vikunja for local development (compose.dev.yaml).
import { serveMocks } from "./server";
import { uptimeKuma } from "./uptime-kuma";
import { vikunja } from "./vikunja";

const server = serveMocks(
  [
    uptimeKuma({ apiKey: process.env.MOCK_KUMA_API_KEY ?? "uk1_dev", prefix: "/kuma" }),
    vikunja({ apiToken: process.env.MOCK_VIKUNJA_TOKEN ?? "tk_dev" }),
  ],
  { port: Number(process.env.PORT ?? 9999), hostname: "0.0.0.0" },
);
console.log(`mocks listening on ${server.url} (uptime kuma under /kuma, vikunja under /api/v1)`);
