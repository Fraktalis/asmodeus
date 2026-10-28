import { authorize } from "../auth/tokens";
import type { AuthConfig } from "../config/load";
import type { Store } from "../store/port";
import { buildOverview, type OverviewCollector } from "./overview";

export type AppOptions = {
  store: Store;
  auth: AuthConfig;
  collectors: OverviewCollector[];
  now?: () => Date;
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function createApp(opts: AppOptions) {
  const now = opts.now ?? (() => new Date());

  return {
    async fetch(req: Request): Promise<Response> {
      const { pathname } = new URL(req.url);

      if (req.method === "GET" && pathname === "/healthz") return json({ ok: true });

      if (req.method === "GET" && pathname === "/api/overview") {
        const decision = authorize(opts.auth, req.headers.get("authorization"), "overview:read");
        if (!decision.ok) return json({ error: decision.status === 401 ? "unauthorized" : "forbidden" }, decision.status);
        return json(await buildOverview(opts.store, opts.collectors, now()));
      }

      return json({ error: "not found" }, 404);
    },
  };
}
