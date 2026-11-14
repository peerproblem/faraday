import { generateText, Output } from "ai";
import { z } from "zod";
import { planLlm } from "../../llm/models";
import type { Usage } from "../../graph/runner";
import { metricSpecSchema, planSchema, tableSpecSchema, widgetPlanSchema, type Plan } from "../../spec";
import { call } from "./util";

const SYSTEM = (now: Date) => `You plan live crisis dashboards ("situation boards"). A user describes a crisis in a sentence or two.
You decide what the board tracks, how to find it on the live web with a news search API and a web search API, and which widgets show it.
Today is ${now.toISOString().slice(0, 10)}.

Language: set language to the language the user wrote in. Write title, subtitle, labels and widget titles in that language. Queries may mix the local language and English when that finds more.

What to track:
- metrics: the 4 to 8 figures that matter most for this crisis type (deaths, injured, evacuated, area burned, customers without power, systems affected...). Keys are kebab-case and stable.
- tables: 0 to 3 crisis-specific lists (road closures, shelters, evacuation zones, affected services, CVEs, outage regions). The first column identifies the row.
- statusGroups: for outages and cyberattacks, groups of services or systems that are up or down. Usually empty for natural disasters.
- questions: the 4 to 6 questions people affected need answered now.
- entities: proper names that identify this specific crisis, so similar events elsewhere can be told apart.
- location: a geocodable place name and a map zoom, or null when there is no physical place. Never give coordinates.

Widgets (in reading order). Available types:
- narrative: the current situation in a few sentences. Always first.
- stat-grid: key figures. metrics lists metric keys. Always include one.
- trend: one metric over time. bind is a metric key. Use for 1 or 2 figures that change during the crisis.
- timeline: events, newest first. Always include.
- map: only for crises with physical places.
- table: bind is a table key. One per table.
- status-grid: bind is a status group key. One per status group.
- alert-list: official warnings and instructions.
- link-list: official pages, hotlines, shelters, donation pages.
- feed, changelog, sources: always last, in that order.
Use span "full" for narrative, stat-grid, map, tables, changelog and sources; "half" for the rest.

Queries must name the specific place, organisation or event so they do not drift to other crises.`;

export async function makePlan(program: string, use: Usage, signal: AbortSignal, now = new Date()): Promise<Plan> {
  const llm = planLlm();
  const r = await generateText({
    ...call(llm),
    output: Output.object({ schema: planSchema }),
    system: SYSTEM(now),
    prompt: program,
    abortSignal: signal,
  });
  use.llm(llm.modelId, r.usage);
  return normalizePlan(r.output);
}

/** Keeps keys unique and kebab-case, and caps list lengths, whatever the model returned. */
export function normalizePlan(plan: Plan): Plan {
  const kebab = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item";
  const uniq = <T extends { key: string }>(items: T[]) => {
    const seen = new Set<string>();
    return items
      .map((x) => ({ ...x, key: kebab(x.key) }))
      .filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
  };
  const metrics = uniq(plan.metrics).slice(0, 8);
  const tables = uniq(plan.tables)
    .slice(0, 3)
    .map((t) => ({ ...t, columns: uniq(t.columns).slice(0, 5) }))
    .filter((t) => t.columns.length >= 1);
  const statusGroups = uniq(plan.statusGroups).slice(0, 3);
  return {
    ...plan,
    language: (plan.language || "en").slice(0, 8),
    entities: plan.entities.slice(0, 8),
    newsQueries: plan.newsQueries.filter(Boolean).slice(0, 5),
    webQueries: plan.webQueries.filter(Boolean).slice(0, 4),
    metrics,
    tables,
    statusGroups,
    questions: plan.questions.slice(0, 6).map((q, i) => ({ id: q.id || `q${i + 1}`, text: q.text })),
    widgets: plan.widgets.map((w) => ({
      ...w,
      bind: w.bind ? kebab(w.bind) : null,
      metrics: w.metrics.map(kebab),
    })),
  };
}

export const planPatchSchema = z.object({
  reply: z.string().describe("One or two sentences to the user, in the board language, about what will change"),
  addMetrics: z.array(metricSpecSchema),
  removeMetricKeys: z.array(z.string()),
  addTables: z.array(tableSpecSchema),
  removeTableKeys: z.array(z.string()),
  addStatusGroups: z.array(z.object({ key: z.string(), title: z.string() })),
  addWidgets: z.array(widgetPlanSchema).describe("New widgets, e.g. a table widget bound to a new table"),
  removeWidgetTitles: z.array(z.string()).describe("Titles of existing widgets to remove"),
  newsQueries: z.array(z.string()).describe("Extra news queries needed for the change, empty if none"),
  webQueries: z.array(z.string()).describe("Extra web queries needed for the change, empty if none"),
  addQuestions: z.array(z.string()),
  monitor: z
    .object({ query: z.string(), instructions: z.string() })
    .nullable()
    .describe(
      "A replacement for the plan's live monitor (search query and judge instructions) when the change shifts which new developments matter, e.g. new figures or lists to watch. Null to keep the current monitor",
    ),
});
export type PlanPatch = z.infer<typeof planPatchSchema>;

export async function makePlanPatch(plan: Plan, instruction: string, use: Usage, signal: AbortSignal, now = new Date()): Promise<PlanPatch> {
  const llm = planLlm();
  const r = await generateText({
    ...call(llm),
    output: Output.object({ schema: planPatchSchema }),
    system: `A user is editing a live crisis board by instruction. Change the plan as little as possible to do what they ask.
Today is ${now.toISOString().slice(0, 10)}. Use kebab-case keys that do not clash with existing ones. Widget types and rules are the same as when planning:
stat-grid lists metric keys in metrics; trend binds a metric key; table binds a table key; status-grid binds a status group key.`,
    prompt: `CURRENT PLAN:\n${JSON.stringify(plan)}\n\nINSTRUCTION: ${instruction}`,
    abortSignal: signal,
  });
  use.llm(llm.modelId, r.usage);
  return r.output;
}

export function applyPlanPatch(plan: Plan, patch: PlanPatch): { plan: Plan; newKeys: { metrics: string[]; tables: string[]; statusGroups: string[] } } {
  const drop = (keys: string[]) => new Set(keys.map((k) => k.toLowerCase()));
  const dropM = drop(patch.removeMetricKeys);
  const dropT = drop(patch.removeTableKeys);
  const dropW = drop(patch.removeWidgetTitles);
  const existingM = new Set(plan.metrics.map((m) => m.key));
  const existingT = new Set(plan.tables.map((t) => t.key));
  const existingS = new Set(plan.statusGroups.map((s) => s.key));
  const next = normalizePlan({
    ...plan,
    metrics: [...plan.metrics.filter((m) => !dropM.has(m.key)), ...patch.addMetrics],
    tables: [...plan.tables.filter((t) => !dropT.has(t.key)), ...patch.addTables],
    statusGroups: [...plan.statusGroups, ...patch.addStatusGroups],
    newsQueries: [...new Set([...plan.newsQueries, ...patch.newsQueries])],
    webQueries: [...new Set([...plan.webQueries, ...patch.webQueries])],
    questions: [...plan.questions, ...patch.addQuestions.map((text, i) => ({ id: `q${plan.questions.length + i + 1}`, text }))],
    widgets: [
      ...plan.widgets.filter((w) => !dropW.has(w.title.toLowerCase())),
      ...patch.addWidgets,
    ],
  });
  if (patch.monitor?.query.trim() && patch.monitor.instructions.trim()) {
    next.monitor = { query: patch.monitor.query.trim(), instructions: patch.monitor.instructions.trim() };
  }
  // normalizePlan caps list lengths; keep news/web query history longer than the cap for edits.
  next.newsQueries = [...new Set([...plan.newsQueries, ...patch.newsQueries])].slice(0, 12);
  next.webQueries = [...new Set([...plan.webQueries, ...patch.webQueries])].slice(0, 10);
  // Feed, changelog and sources stay last.
  const tail = new Set(["feed", "changelog", "sources"]);
  next.widgets = [...next.widgets.filter((w) => !tail.has(w.type)), ...next.widgets.filter((w) => tail.has(w.type))];
  return {
    plan: next,
    newKeys: {
      metrics: next.metrics.map((m) => m.key).filter((k) => !existingM.has(k)),
      tables: next.tables.map((t) => t.key).filter((k) => !existingT.has(k)),
      statusGroups: next.statusGroups.map((s) => s.key).filter((k) => !existingS.has(k)),
    },
  };
}
