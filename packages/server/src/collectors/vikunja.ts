import { z } from "zod";
import type { CollectorType, Observation, Rule } from "@asmodeus/contracts";
import { httpGet, joinUrl } from "./http";

const ConfigSchema = z.object({
  baseUrl: z.url(),
  /** Vikunja API token with read access to tasks. */
  apiToken: z.string().min(1),
  /** Only report tasks of these projects; all projects when omitted. */
  projectIds: z.array(z.number().int()).optional(),
  pageSize: z.number().int().min(1).max(250).default(50),
});
type Config = z.infer<typeof ConfigSchema>;

const TaskSchema = z.object({
  id: z.number(),
  title: z.string(),
  done: z.boolean(),
  due_date: z.string().nullable().optional(),
  project_id: z.number(),
  priority: z.number(),
  identifier: z.string().optional(),
  percent_done: z.number().optional(),
  updated: z.string(),
});
type Task = z.infer<typeof TaskSchema>;

const MAX_PAGES = 100;

/** Vikunja encodes unset dates as year 1. */
function dateOrNull(value: string | null | undefined): string | null {
  if (!value || value.startsWith("0001-01-01")) return null;
  return new Date(value).toISOString();
}

function toObservation(task: Task, collectorId: string, baseUrl: string, now: Date): Observation {
  const dueDate = dateOrNull(task.due_date);
  const overdue = dueDate !== null && Date.parse(dueDate) < now.getTime();
  return {
    entityKey: `vikunja:${collectorId}/task/${task.id}`,
    kind: "task",
    status: overdue ? "warn" : "ok",
    summary: task.identifier ? `${task.identifier} ${task.title}` : task.title,
    attributes: {
      taskId: task.id,
      title: task.title,
      identifier: task.identifier || null,
      projectId: task.project_id,
      priority: task.priority,
      dueDate,
      percentDone: task.percent_done ?? 0,
      updated: new Date(task.updated).toISOString(),
    },
    sourceUrl: joinUrl(baseUrl, `/tasks/${task.id}`),
    observedAt: now.toISOString(),
  };
}

const taskOverdue: Rule<{ graceHours: number; critPriority: number }> = {
  id: "vikunja.task_overdue",
  description: "An open task is past its due date.",
  paramsSchema: z.object({ graceHours: z.number().min(0).default(0), critPriority: z.number().int().default(4) }),
  evaluate({ observation }, now, { graceHours, critPriority }) {
    const { dueDate, priority, title } = observation.attributes as { dueDate: string | null; priority: number; title: string };
    if (!dueDate || Date.parse(dueDate) + graceHours * 3_600_000 > now.getTime()) return null;
    return {
      severity: priority >= critPriority ? "crit" : "warn",
      reason: `"${title}" was due ${dueDate}`,
      decisionNeeded: "Do it, reschedule it or drop it.",
    };
  },
};

const urgentStale: Rule<{ minPriority: number; staleDays: number }> = {
  id: "vikunja.urgent_stale",
  description: "A high-priority open task has not been updated for a while.",
  paramsSchema: z.object({ minPriority: z.number().int().default(4), staleDays: z.number().min(1).default(7) }),
  evaluate({ observation }, now, { minPriority, staleDays }) {
    const { updated, priority, title } = observation.attributes as { updated: string; priority: number; title: string };
    if (priority < minPriority || now.getTime() - Date.parse(updated) < staleDays * 86_400_000) return null;
    return {
      severity: "warn",
      reason: `High-priority "${title}" untouched since ${updated}`,
      decisionNeeded: "Still urgent? Lower its priority or schedule it.",
    };
  },
};

export const vikunjaType: CollectorType<Config> = {
  type: "vikunja",
  configSchema: ConfigSchema,
  rules: [taskOverdue, urgentStale],
  create(config, ctx) {
    const fetchPage = (page: number, perPage: number) => {
      const qs = new URLSearchParams({ filter: "done = false", page: String(page), per_page: String(perPage) });
      return httpGet(ctx.fetch, joinUrl(config.baseUrl, `/api/v1/tasks/all?${qs}`), {
        headers: { authorization: `Bearer ${config.apiToken}` },
        parse: async (res) => z.array(TaskSchema).parse(await res.json()),
      });
    };

    return {
      async health() {
        const res = await fetchPage(1, 1);
        return res.ok ? { ok: true } : { ok: false, message: res.error };
      },

      async collect() {
        const tasks: Task[] = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
          const res = await fetchPage(page, config.pageSize);
          if (!res.ok) return { ok: false, error: res.error };
          tasks.push(...res.value);
          const totalPages = Number(res.response.headers.get("x-pagination-total-pages"));
          const last = Number.isFinite(totalPages) && totalPages > 0 ? page >= totalPages : res.value.length < config.pageSize;
          if (last) break;
        }

        const now = ctx.now();
        const wanted = config.projectIds ? new Set(config.projectIds) : null;
        const unique = new Map(tasks.filter((t) => !t.done && (!wanted || wanted.has(t.project_id))).map((t) => [t.id, t]));
        return {
          ok: true,
          observations: [...unique.values()].map((t) => toObservation(t, ctx.id, config.baseUrl, now)),
        };
      },

      tools: () => [],
    };
  },
};
