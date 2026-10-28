import { fixture, type MockHandler, type MockResponse } from "./server";

type Task = { done: boolean };

/**
 * Fake Vikunja `GET /api/v1/tasks/all`: bearer API token, `filter=done = false`,
 * `page`/`per_page` pagination with the `x-pagination-total-pages` header.
 */
export function vikunja(opts: { apiToken: string; tasks?: () => Task[] }): MockHandler {
  const tasks = opts.tasks ?? (() => JSON.parse(fixture("vikunja/tasks.json")) as Task[]);
  return (req, url): MockResponse | null => {
    if (url.pathname !== "/api/v1/tasks/all") return null;
    if (req.headers.get("authorization") !== `Bearer ${opts.apiToken}`) {
      return { status: 401, headers: { "content-type": "application/json" }, body: '{"code":11,"message":"invalid token"}' };
    }
    const filter = url.searchParams.get("filter");
    const all = filter === "done = false" ? tasks().filter((t) => !t.done) : tasks();
    const perPage = Number(url.searchParams.get("per_page") ?? 50);
    const page = Number(url.searchParams.get("page") ?? 1);
    const totalPages = Math.max(1, Math.ceil(all.length / perPage));
    return {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-pagination-total-pages": String(totalPages),
        "x-pagination-result-count": String(Math.max(0, Math.min(perPage, all.length - (page - 1) * perPage))),
      },
      body: JSON.stringify(all.slice((page - 1) * perPage, page * perPage)),
    };
  };
}
