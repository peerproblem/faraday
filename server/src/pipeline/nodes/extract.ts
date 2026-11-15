import { generateText, Output } from "ai";
import { z } from "zod";
import { fastLlm, GROUNDING_RULES } from "../../llm/models";
import type { Usage } from "../../graph/runner";
import { factKinds, type ExtractedFact, type FactKind, type Plan, type Source } from "../../spec";
import { call, LIMITS, slugify, sourceLine } from "./util";

import { advisoryAudiences, resourcePurposes, statusScopes } from "../../spec/cyber";

const n = <T extends z.ZodTypeAny>(t: T) => t.nullable();

/** Flat on purpose: one object shape for every kind keeps structured output reliable. */
const rawFactSchema = z.object({
  kind: z.enum(factKinds),
  key: z.string().describe("metric: a metric key from the plan, or new:<kebab-key> for an important figure the plan lacks. Others: any short label"),
  sourceId: z.string().describe("The id of the one source that states this, e.g. s4"),
  quote: z.string().describe("The sentence from that source, copied exactly, at most 300 characters"),
  asOf: n(z.string()).describe("ISO 8601 time the fact refers to, from the source. Null if the source gives none"),
  valueText: n(z.string()).describe("metric: the figure exactly as written in the source"),
  valueNum: n(z.number()).describe("metric: the figure as a number"),
  unit: n(z.string()),
  scope: n(z.string()).describe("metric: what the figure covers, e.g. 'Valencia province'"),
  title: n(z.string()).describe("event, advisory: short title"),
  detail: n(z.string()).describe("event: one sentence"),
  importance: n(z.enum(["high", "medium", "low"])),
  name: n(z.string()).describe("place: place name. status: service or system name"),
  placeKind: n(z.enum(["impact", "incident", "shelter", "closure", "resource", "origin"])),
  note: n(z.string()),
  issuer: n(z.string()).describe("advisory: the authority"),
  text: n(z.string()).describe("advisory: what people must do"),
  level: n(z.enum(["warning", "watch", "info"])),
  url: n(z.string()).describe("advisory, resource: a URL that appears in the source"),
  active: n(z.boolean()).describe("advisory: false when the source says it was lifted"),
  label: n(z.string()).describe("resource: link label"),
  resourceKind: n(z.enum(["official", "donate", "shelter", "hotline", "volunteer", "info"])),
  table: n(z.string()).describe("row: a table key from the plan"),
  cells: n(z.array(z.object({ column: z.string(), value: z.string() }))).describe("row: one entry per column key"),
  group: n(z.string()).describe("status: a status group key from the plan"),
  audience: n(z.enum(advisoryAudiences)).optional().describe("advisory: intended audience explicitly supported by the source. users = affected individuals; operators = organisations or system administrators; both; unknown when unclear. Null for other fact kinds."),
  resourcePurpose: n(z.enum(resourcePurposes)).optional().describe("resource: availability = service or product status; verification = official personal eligibility/account check; guidance = instructions or patches; updates = incident announcements; other. Classify the linked page's stated purpose, never invent a URL."),
  statusScope: n(z.enum(statusScopes)).optional().describe("status: overall only if the source explicitly covers the entire affected service; component for a subset, region, network or feature; unknown otherwise. A restored subset does not mean overall recovery."),
  state: n(z.enum(["operational", "degraded", "down", "unknown"])),
});
type RawFact = z.infer<typeof rawFactSchema>;

const outputSchema = z.object({ facts: z.array(rawFactSchema) });

export type Focus = { metrics?: string[]; tables?: string[]; statusGroups?: string[] };

/**
 * Picks the sources to extract: kept by triage, not extracted yet. Reserves up to 40% for official and web sources
 * (they carry advisories, shelters and status pages), then fills with the rest by relevance, facts and recency.
 */
export function pickExtractSources(sources: Source[], cap = LIMITS.maxExtract(), hasFacts: Record<string, number> = {}): Source[] {
  const eligible = sources.filter((s) => (s.relevance ?? 0) > 0);
  const score = (s: Source) => (s.relevance ?? 0) + 0.5 * (hasFacts[s.id] ?? 0.5);
  const primary = eligible
    .filter((s) => s.sourceType === "official" || s.kind === "web")
    .sort((a, b) => score(b) - score(a))
    .slice(0, Math.ceil(cap * 0.4));
  const taken = new Set(primary.map((s) => s.id));
  const rest = eligible
    .filter((s) => !taken.has(s.id))
    .sort((a, b) => score(b) - score(a) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, Math.max(0, cap - primary.length));
  return [...primary, ...rest];
}

export function batches<T>(items: T[], size = LIMITS.extractBatch): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function schemaText(plan: Plan, focus?: Focus): string {
  const metrics = plan.metrics.filter((m) => !focus?.metrics || focus.metrics.includes(m.key));
  const tables = plan.tables.filter((t) => !focus?.tables || focus.tables.includes(t.key));
  const groups = plan.statusGroups.filter((g) => !focus?.statusGroups || focus.statusGroups.includes(g.key));
  return [
    `Metrics (kind=metric, key=metric key):\n${metrics.map((m) => `- ${m.key}: ${m.label}${m.unit ? ` (${m.unit})` : ""}`).join("\n") || "- none"}`,
    `Tables (kind=row, table=table key, cells by column key):\n${tables.map((t) => `- ${t.key}: ${t.title}; columns ${t.columns.map((c) => `${c.key} (${c.label})`).join(", ")}`).join("\n") || "- none"}`,
    `Status groups (kind=status, group=group key):\n${groups.map((g) => `- ${g.key}: ${g.title}`).join("\n") || "- none"}`,
  ].join("\n\n");
}

export async function extractBatch(
  plan: Plan,
  batch: Source[],
  texts: Map<string, string>,
  use: Usage,
  signal: AbortSignal,
  opts: { focus?: Focus; now?: Date } = {},
): Promise<ExtractedFact[]> {
  if (batch.length === 0) return [];
  const llm = fastLlm();
  const focused = !!opts.focus;
  const r = await generateText({
    ...call(llm),
    output: Output.object({ schema: outputSchema }),
    system: `You extract facts for a live crisis board from web sources. Board: "${plan.title}"${plan.location ? ` in ${plan.location.name}` : ""}.
Now: ${(opts.now ?? new Date()).toISOString()}.

${GROUNDING_RULES}

Extract only facts about this crisis. Every fact cites exactly one source id from this batch and quotes it word for word.
${focused ? "Extract ONLY the metrics, table rows and statuses listed below." : `Kinds:
- metric: a figure for one of the metrics below.
- event: something that happened, with its time when the source gives it.
- place: a named place that is affected, closed, or a shelter or resource. Never give coordinates.
- advisory: an official warning or instruction.
- resource: an official page, hotline, shelter or donation link that appears in the source.
- row: one row of a table below. status: the state of a service or system in a status group below.`}
Write title, detail, note, label and text in English. The quote stays in the source language.

${schemaText(plan, opts.focus)}`,
    prompt: `SOURCES:\n${batch.map((s) => sourceLine(s, texts.get(s.id) ?? null, LIMITS.maxTextChars)).join("\n\n")}`,
    abortSignal: signal,
  });
  use.llm(llm.modelId, r.usage);
  const ids = new Set(batch.map((s) => s.id));
  return r.output.facts.map((f) => toExtracted(f, plan)).filter((f): f is ExtractedFact => !!f && ids.has(f.sourceId)).filter((f) => inFocus(f, opts.focus));
}

function inFocus(f: ExtractedFact, focus?: Focus): boolean {
  if (!focus) return true;
  if (f.kind === "metric") return !!focus.metrics?.includes(f.key);
  if (f.kind === "row") return !!focus.tables?.includes((f.payload as { table: string }).table);
  if (f.kind === "status") return !!focus.statusGroups?.includes((f.payload as { group: string }).group);
  return false;
}

const str = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Converts the flat model output into a typed fact, computing keys in code. Null when required fields are missing. */
export function toExtracted(f: RawFact, plan: Plan): ExtractedFact | null {
  const quote = str(f.quote)?.slice(0, 300);
  const sourceId = str(f.sourceId);
  if (!quote || !sourceId) return null;
  const base = { sourceId, quote, asOf: str(f.asOf) };
  const kind = f.kind as FactKind;
  switch (kind) {
    case "metric": {
      const valueText = str(f.valueText);
      const raw = str(f.key);
      if (!valueText || !raw) return null;
      // The model may write a plan key in another case or with spaces ("Deaths", "people evacuated").
      const canon = (k: string) => k.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const known = plan.metrics.find((m) => m.key === raw || canon(m.key) === canon(raw))?.key;
      const key = known ?? (raw.startsWith("new:") ? `new:${slugify(raw.slice(4))}` : `new:${slugify(raw)}`);
      return { ...base, kind, key, payload: { valueText, valueNum: typeof f.valueNum === "number" && Number.isFinite(f.valueNum) ? f.valueNum : null, unit: str(f.unit), scope: str(f.scope) } };
    }
    case "event": {
      const title = str(f.title);
      if (!title) return null;
      return { ...base, kind, key: slugify(title), payload: { title, detail: str(f.detail) ?? "", importance: f.importance ?? "medium" } };
    }
    case "place": {
      const name = str(f.name);
      if (!name || !f.placeKind) return null;
      return { ...base, kind, key: slugify(name), payload: { name, placeKind: f.placeKind, note: str(f.note) ?? "" } };
    }
    case "advisory": {
      const title = str(f.title);
      if (!title) return null;
      return {
        ...base,
        kind,
        key: slugify(title),
        payload: { issuer: str(f.issuer) ?? "", title, text: str(f.text) ?? "", level: f.level ?? "info", url: str(f.url), active: f.active !== false, ...(plan.crisisType === "cyberattack" && f.audience ? { audience: f.audience } : {}) },
      };
    }
    case "resource": {
      const url = str(f.url);
      const label = str(f.label) ?? str(f.title);
      if (!url || !label) return null;
      return { ...base, kind, key: slugify(label), payload: { label, url, resourceKind: f.resourceKind ?? "info", note: str(f.note) ?? "", ...(plan.crisisType === "cyberattack" && f.resourcePurpose ? { purpose: f.resourcePurpose } : {}) } };
    }
    case "row": {
      const table = plan.tables.find((t) => t.key === str(f.table));
      if (!table || !f.cells?.length) return null;
      const cells: Record<string, string> = {};
      for (const c of f.cells) {
        const col = table.columns.find((x) => x.key === c.column || x.label === c.column);
        if (col && str(c.value)) cells[col.key] = c.value.trim();
      }
      const first = cells[table.columns[0]?.key ?? ""];
      if (!first) return null;
      const responseTime = table.key === "incident-totals" ? cells["reporting-window-end"]
        : table.key === "operational-incidents" ? cells["status-as-of"] : undefined;
      // Cyber scope rows identify a product/version or asset/network tuple, not just their first cell.
      const subjects = plan.crisisType === "cyberattack" && table.cyberRole === "affected-scope" ? table.columns.filter(column => column.cyberRole === "subject") : [];
      const identity = table.key === "operational-incidents" ? cells["incident-id"] || `${cells.region ?? ""} ${first}`
        : subjects.length ? subjects.map(column => cells[column.key] ?? "").join(" · ") : first;
      return { ...base, asOf: responseTime || base.asOf, kind, key: `${table.key}:${slugify(identity)}`, payload: { table: table.key, cells } };
    }
    case "status": {
      const group = plan.statusGroups.find((g) => g.key === str(f.group));
      const name = str(f.name);
      if (!group || !name) return null;
      return { ...base, kind, key: `${group.key}:${slugify(name)}`, payload: { group: group.key, name, state: f.state ?? "unknown", note: str(f.note) ?? "", ...(plan.crisisType === "cyberattack" && f.statusScope ? { scope: f.statusScope } : {}) } };
    }
  }
}
