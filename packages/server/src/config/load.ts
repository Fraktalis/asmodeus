import { z } from "zod";
import type { CollectorType } from "@asmodeus/contracts";

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

const LOCALHOST = ["127.0.0.1", "::1", "localhost"];

export const SCOPES = ["overview:read"] as const;
export type Scope = (typeof SCOPES)[number];

const TokenSchema = z.object({
  name: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase hex sha256 digest"),
  scopes: z.array(z.enum(SCOPES)).min(1),
});

const AuthSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("tokens"), tokens: z.array(TokenSchema).min(1) }),
]);

const RuleOverrideSchema = z.object({
  enabled: z.boolean().default(true),
  params: z.record(z.string(), z.unknown()).default({}),
});

const RawCollectorSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "lowercase letters, digits, '-' and '_' only"),
  type: z.string(),
  intervalSeconds: z.number().int().min(5).default(60),
  config: z.unknown(),
  rules: z.record(z.string(), RuleOverrideSchema).default({}),
});

const RawConfigSchema = z.object({
  server: z
    .object({ host: z.string().default("0.0.0.0"), port: z.number().int().min(1).max(65535).default(8080) })
    .default({ host: "0.0.0.0", port: 8080 }),
  dataDir: z.string().default("./data"),
  auth: AuthSchema,
  attention: z
    .object({
      flapWindowMinutes: z.number().int().min(0).default(60),
      collectorUnreachableMinutes: z.number().int().min(0).default(5),
    })
    .default({ flapWindowMinutes: 60, collectorUnreachableMinutes: 5 }),
  retention: z.object({ transitionsDays: z.number().int().min(1).default(90) }).default({ transitionsDays: 90 }),
  collectors: z.array(RawCollectorSchema).default([]),
});

export type RuleSettings = { enabled: boolean; params: unknown };

export type CollectorConfig = {
  id: string;
  type: string;
  intervalSeconds: number;
  config: unknown;
  /** Every rule of the collector type, with defaults applied. */
  rules: Record<string, RuleSettings>;
};

export type Config = Omit<z.infer<typeof RawConfigSchema>, "collectors"> & { collectors: CollectorConfig[] };
export type AuthConfig = Config["auth"];

const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Interpolates `${VAR}` in string values only, after parsing, so env values are never parsed as YAML. */
function interpolate(value: unknown, env: Record<string, string | undefined>, path: string, issues: string[]): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_REF, (_, name: string) => {
      const v = env[name];
      if (v === undefined) {
        issues.push(`${path}: environment variable ${name} is not set`);
        return "";
      }
      return v;
    });
  }
  if (Array.isArray(value)) return value.map((v, i) => interpolate(v, env, `${path}.${i}`, issues));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolate(v, env, path ? `${path}.${k}` : k, issues)]),
    );
  }
  return value;
}

function formatIssues(error: z.ZodError, prefix: string): string[] {
  return error.issues.map((i) => {
    const path = [prefix, ...i.path.map(String)].filter(Boolean).join(".");
    return `${path || "(root)"}: ${i.message}`;
  });
}

export function loadConfig(
  yamlText: string,
  env: Record<string, string | undefined>,
  registry: CollectorType<any>[],
): Config {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(yamlText);
  } catch (e) {
    throw new ConfigError([`YAML: ${(e as Error).message}`]);
  }

  const issues: string[] = [];
  const interpolated = interpolate(parsed, env, "", issues);
  if (issues.length) throw new ConfigError(issues);

  const raw = RawConfigSchema.safeParse(interpolated);
  if (!raw.success) throw new ConfigError(formatIssues(raw.error, ""));
  const cfg = raw.data;

  if (cfg.auth.mode === "none" && !LOCALHOST.includes(cfg.server.host)) {
    issues.push(`auth: auth.mode none is only allowed when server.host is 127.0.0.1 (got ${cfg.server.host})`);
  }

  const types = new Map(registry.map((t) => [t.type, t]));
  const seen = new Set<string>();
  const collectors: CollectorConfig[] = [];

  cfg.collectors.forEach((c, i) => {
    const at = `collectors.${i}`;
    if (seen.has(c.id)) issues.push(`${at}.id: duplicate collector id "${c.id}"`);
    seen.add(c.id);

    const type = types.get(c.type);
    if (!type) {
      issues.push(`${at}.type: unknown collector type "${c.type}" (known: ${[...types.keys()].join(", ")})`);
      return;
    }

    const config = type.configSchema.safeParse(c.config ?? {});
    if (!config.success) issues.push(...formatIssues(config.error, `${at}.config`));

    const ruleIds = new Set(type.rules.map((r) => r.id));
    for (const id of Object.keys(c.rules)) {
      if (!ruleIds.has(id)) issues.push(`${at}.rules: unknown rule "${id}" for type ${c.type}`);
    }

    const rules: Record<string, RuleSettings> = {};
    for (const rule of type.rules) {
      const override = c.rules[rule.id] ?? { enabled: true, params: {} };
      const params = rule.paramsSchema.safeParse(override.params);
      if (!params.success) issues.push(...formatIssues(params.error, `${at}.rules.${rule.id}.params`));
      rules[rule.id] = { enabled: override.enabled, params: params.success ? params.data : undefined };
    }

    collectors.push({
      id: c.id,
      type: c.type,
      intervalSeconds: c.intervalSeconds,
      config: config.success ? config.data : undefined,
      rules,
    });
  });

  if (issues.length) throw new ConfigError(issues);
  return { ...cfg, collectors };
}
