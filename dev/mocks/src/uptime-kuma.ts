import { fixture, type MockHandler } from "./server";

/**
 * Fake Uptime Kuma `/metrics` endpoint. Mirrors the real API key scheme:
 * HTTP basic auth with an empty username and the key as password.
 */
export function uptimeKuma(opts: { apiKey: string; prefix?: string; metrics?: () => string }): MockHandler {
  const prefix = opts.prefix ?? "";
  const metrics = opts.metrics ?? (() => fixture("uptime-kuma/metrics.txt"));
  return (req, url) => {
    if (url.pathname !== `${prefix}/metrics`) return null;
    if (req.headers.get("authorization") !== `Basic ${btoa(`:${opts.apiKey}`)}`) {
      return { status: 401, body: "Unauthorized" };
    }
    return { status: 200, headers: { "content-type": "text/plain; version=0.0.4" }, body: metrics() };
  };
}
