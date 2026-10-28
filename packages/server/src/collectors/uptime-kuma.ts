import { z } from "zod";
import type { CollectorType, Observation, Rule, Status } from "@asmodeus/contracts";
import { httpGet, joinUrl } from "./http";

const ConfigSchema = z.object({
  baseUrl: z.url(),
  /** Uptime Kuma API key; omit if /metrics auth is disabled. */
  apiKey: z.string().min(1).optional(),
});
type Config = z.infer<typeof ConfigSchema>;

type Sample = { name: string; labels: Record<string, string>; value: number };

/** Minimal Prometheus text-format parser: only what Uptime Kuma emits. */
export function parsePrometheus(text: string): Sample[] {
  const samples: Sample[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)/.exec(line);
    if (!m) continue;
    const labels: Record<string, string> = {};
    const labelRe = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
    for (const l of (m[2] ?? "").matchAll(labelRe)) {
      labels[l[1]!] = l[2]!.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c));
    }
    samples.push({ name: m[1]!, labels, value: Number(m[3]) });
  }
  return samples;
}

const STATUS: Record<number, Status> = { 1: "ok", 0: "crit", 2: "warn", 3: "ok" };
const STATUS_LABEL: Record<number, string> = { 1: "up", 0: "down", 2: "pending", 3: "maintenance" };

function target(labels: Record<string, string>): string | null {
  const set = (v: string | undefined) => (v && v !== "null" && v !== "https://" ? v : null);
  const host = set(labels.monitor_hostname);
  const port = set(labels.monitor_port);
  if (host) return port ? `${host}:${port}` : host;
  return set(labels.monitor_url);
}

function toObservations(samples: Sample[], collectorId: string, baseUrl: string, observedAt: string): Observation[] {
  const monitors = new Map<string, { labels: Record<string, string>; values: Record<string, number> }>();
  for (const s of samples) {
    if (!s.name.startsWith("monitor_")) continue;
    const name = s.labels.monitor_name;
    if (name === undefined) continue;
    const m = monitors.get(name) ?? { labels: s.labels, values: {} };
    m.values[s.name] = s.value;
    monitors.set(name, m);
  }

  const observations: Observation[] = [];
  for (const [name, { labels, values }] of monitors) {
    const raw = values.monitor_status;
    if (raw === undefined) continue;
    const status = STATUS[raw] ?? "unknown";
    const responseTime = values.monitor_response_time;
    observations.push({
      entityKey: `uptime_kuma:${collectorId}/${encodeURIComponent(name)}`,
      kind: "monitor",
      status,
      summary: `${name} is ${STATUS_LABEL[raw] ?? `in unknown state ${raw}`}`,
      attributes: {
        name,
        monitorType: labels.monitor_type ?? null,
        target: target(labels),
        maintenance: raw === 3,
        responseTimeMs: responseTime !== undefined && responseTime >= 0 ? responseTime : null,
        certDaysRemaining: values.monitor_cert_days_remaining ?? null,
        certValid: values.monitor_cert_is_valid === undefined ? null : values.monitor_cert_is_valid === 1,
      },
      sourceUrl: joinUrl(baseUrl, "/dashboard"),
      observedAt,
    });
  }
  return observations;
}

const monitorDown: Rule<{ forMinutes: number }> = {
  id: "uptime_kuma.monitor_down",
  description: "A monitor has been down for longer than the threshold.",
  paramsSchema: z.object({ forMinutes: z.number().min(0).default(5) }),
  evaluate({ observation, statusSince }, now, { forMinutes }) {
    if (observation.status !== "crit") return null;
    const downMs = now.getTime() - new Date(statusSince).getTime();
    if (downMs < forMinutes * 60_000) return null;
    return { severity: "crit", reason: `${observation.attributes.name} is down since ${statusSince}` };
  },
};

const certExpiring: Rule<{ warnDays: number; critDays: number }> = {
  id: "uptime_kuma.cert_expiring",
  description: "A monitored TLS certificate expires soon.",
  paramsSchema: z.object({ warnDays: z.number().default(14), critDays: z.number().default(3) }),
  evaluate({ observation }, _now, { warnDays, critDays }) {
    const days = observation.attributes.certDaysRemaining;
    if (typeof days !== "number" || days >= warnDays) return null;
    return {
      severity: days < critDays ? "crit" : "warn",
      reason: `TLS certificate of ${observation.attributes.name} expires in ${days} days`,
      decisionNeeded: "Renew the certificate or check automatic renewal.",
    };
  },
};

export const uptimeKumaType: CollectorType<Config> = {
  type: "uptime_kuma",
  configSchema: ConfigSchema,
  rules: [monitorDown, certExpiring],
  create(config, ctx) {
    const fetchMetrics = () =>
      httpGet(ctx.fetch, joinUrl(config.baseUrl, "/metrics"), {
        headers: config.apiKey ? { authorization: `Basic ${btoa(`:${config.apiKey}`)}` } : {},
        parse: (res) => res.text(),
      });

    return {
      async health() {
        const res = await fetchMetrics();
        return res.ok ? { ok: true } : { ok: false, message: res.error };
      },
      async collect() {
        const res = await fetchMetrics();
        if (!res.ok) return { ok: false, error: res.error };
        const samples = parsePrometheus(res.value);
        // An instance without monitors is valid; a page with no samples at all is not /metrics.
        if (samples.length === 0) return { ok: false, error: "response is not Prometheus metrics" };
        return {
          ok: true,
          observations: toObservations(samples, ctx.id, config.baseUrl, ctx.now().toISOString()),
        };
      },
      tools: () => [],
    };
  },
};
