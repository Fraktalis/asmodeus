export type HttpResult<T> = { ok: true; value: T; response: Response } | { ok: false; error: string };

/** GET with timeout; any network or HTTP failure becomes a message, never a throw. */
export async function httpGet<T>(
  fetchFn: typeof fetch,
  url: string,
  init: { headers?: Record<string, string>; timeoutMs?: number; parse: (res: Response) => Promise<T> },
): Promise<HttpResult<T>> {
  try {
    const response = await fetchFn(url, {
      headers: init.headers,
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
      redirect: "error",
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status} from ${redactUrl(url)}` };
    return { ok: true, value: await init.parse(response), response };
  } catch (e) {
    return { ok: false, error: `${(e as Error).name}: ${(e as Error).message} (${redactUrl(url)})` };
  }
}

function redactUrl(url: string): string {
  const u = new URL(url);
  u.username = "";
  u.password = "";
  u.search = "";
  return u.toString();
}

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}
