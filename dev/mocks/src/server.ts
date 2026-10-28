import { readFileSync } from "node:fs";

export type MockResponse = { status: number; headers?: Record<string, string>; body: string };

/** A fake source: returns a response for requests it owns, or null. */
export type MockHandler = (req: Request, url: URL) => MockResponse | null | Promise<MockResponse | null>;

export type MockServer = { url: string; stop(): Promise<void> };

/** Serves fake sources on one port. Port 0 picks a free port (tests). */
export function serveMocks(handlers: MockHandler[], opts: { port?: number; hostname?: string } = {}): MockServer {
  const server = Bun.serve({
    port: opts.port ?? 0,
    hostname: opts.hostname ?? "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      for (const handle of handlers) {
        const res = await handle(req, url);
        if (res) return new Response(res.body, { status: res.status, headers: res.headers });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://${server.hostname}:${server.port}`, stop: () => server.stop(true) };
}

export function fixture(path: string): string {
  return readFileSync(new URL(`../fixtures/${path}`, import.meta.url), "utf8");
}
