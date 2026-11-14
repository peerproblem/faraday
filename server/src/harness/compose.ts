import { generateText, Output, streamText } from "ai";
import { z } from "zod";
import { GROUNDING_RULES, smartLlm } from "../llm";
import {
  advisorySchema,
  boardSpecSchema,
  kpiSchema,
  mapPointSchema,
  timelineEventSchema,
  type BoardSpec,
  type Source,
} from "../spec";
import type { Plan } from "./plan";

export function formatSources(sources: Source[], maxChars = 900) {
  return sources
    .map((s) => {
      const snippet = (s.snippet ?? "").replace(/\s+/g, " ").slice(0, maxChars);
      return `[${s.id}] ${s.publisher ?? ""} | ${s.publishedAt ?? "date unknown"} | ${s.title ?? s.url}\n${s.url}\n${snippet}`;
    })
    .join("\n\n");
}

function pickSources(sources: Source[], max = 70) {
  return [...sources]
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, max);
}

export async function composeBoard(
  program: string,
  plan: Plan,
  sources: Source[],
  onPartial?: (partial: unknown) => void,
  now = new Date(),
): Promise<BoardSpec> {
  const picked = pickSources(sources);
  const result = streamText({
    ...smartLlm(),
    output: Output.object({ schema: boardSpecSchema }),
    system: `You compile a live crisis dashboard ("situation board") from a user's program and live web sources.
The program is the user's description of the crisis and what they want to see. The dashboard is the output of that program.
Now: ${now.toISOString()}.

${GROUNDING_RULES}

How to fill the board:
- headline: one sentence on the current state, with the latest figure that matters.
- summary.text: 3 to 5 sentences. What happened, what is happening now, what happens next.
- kpis: 3 to 6 figures that matter most for this crisis type (deaths, evacuated, area burned, outages, systems affected...). value as text exactly as sourced.
- timeline: 5 to 12 events, newest first, with ISO times when the source gives a date.
- mapPoints: only real named places you can place with confidence; coordinates may be approximate (city level). Empty for non-physical crises.
- tables: the crisis-specific lists from the plan, filled from sources. Keep rows short. Omit a table if sources have nothing for it.
- advisories: official warnings or instructions from authorities, with their URL when a source gives it.
- help: official pages, hotlines, shelters, donation pages that appear in the sources. Only URLs that appear in the sources.
- layout: the sections in the order a person scanning the board needs them. Use the plan's sections, drop sections you have no data for, and always keep news, changes and sources at the end. For table sections set tableId.
- accent: red for life-threatening, orange for fire, blue for water and storms, violet for cyber, amber for warnings, teal for health.
Ids: kpi k1.., timeline t1.., map m1.., table tb1.., advisory a1.., help h1...`,
    prompt: `PROGRAM:\n${program}\n\nPLAN:\n${JSON.stringify(plan)}\n\nSOURCES (${picked.length}):\n${formatSources(picked)}`,
  });
  let last = 0;
  for await (const partial of result.partialOutputStream) {
    if (onPartial && Date.now() - last > 700) {
      last = Date.now();
      onPartial(partial);
    }
  }
  return sanitize(await result.output, sources);
}

export const boardPatchSchema = z.object({
  irrelevantSourceIds: z
    .array(z.string())
    .describe("Ids of new sources that are not about this crisis at all. They will be dropped from the board."),
  changed: z.boolean().describe("False when the new sources add nothing new"),
  changeNote: z.string().describe("One sentence for the change log: what is new"),
  headline: z.string().nullable(),
  status: z.enum(["developing", "ongoing", "contained", "recovering", "resolved"]).nullable(),
  severity: z.number().int().min(1).max(5).nullable(),
  summary: z.object({ text: z.string(), sources: z.array(z.string()) }).nullable(),
  kpiUpdates: z.array(kpiSchema).describe("KPIs to add or replace, matched by id or label"),
  newTimeline: z.array(timelineEventSchema),
  newMapPoints: z.array(mapPointSchema),
  newAdvisories: z.array(advisorySchema),
  tableRowsToAdd: z.array(z.object({ tableId: z.string(), rows: z.array(z.array(z.string())), sources: z.array(z.string()) })),
});

export type BoardPatch = z.infer<typeof boardPatchSchema>;

export async function patchBoard(spec: BoardSpec, newSources: Source[], now = new Date()): Promise<BoardPatch> {
  const { output } = await generateText({
    ...smartLlm(),
    output: Output.object({ schema: boardPatchSchema }),
    system: `You keep a live crisis dashboard up to date. New sources arrived from the live web.
Decide what they change on the board. Only report real news: a new figure, a new event, a new warning, a status change.
Now: ${now.toISOString()}.

${GROUNDING_RULES}

Use new ids that do not exist on the board (k, t, m, a prefixes with higher numbers). To replace a KPI keep its id.
If nothing on the board should change, set changed=false and leave the lists empty.`,
    prompt: `CURRENT BOARD:\n${JSON.stringify(spec)}\n\nNEW SOURCES:\n${formatSources(newSources, 1200)}`,
  });
  return output;
}

export function applyPatch(spec: BoardSpec, patch: BoardPatch, sources: Source[]): BoardSpec {
  const next: BoardSpec = structuredClone(spec);
  if (patch.headline) next.headline = patch.headline;
  if (patch.status) next.status = patch.status;
  if (patch.severity) next.severity = patch.severity;
  if (patch.summary) next.summary = patch.summary;
  for (const k of patch.kpiUpdates) {
    const i = next.kpis.findIndex((x) => x.id === k.id || x.label.toLowerCase() === k.label.toLowerCase());
    if (i >= 0) next.kpis[i] = { ...k, id: next.kpis[i].id };
    else next.kpis.push(k);
  }
  next.timeline = [...patch.newTimeline, ...next.timeline];
  next.mapPoints = [...next.mapPoints, ...patch.newMapPoints];
  next.advisories = [...patch.newAdvisories, ...next.advisories];
  for (const t of patch.tableRowsToAdd) {
    const table = next.tables.find((x) => x.id === t.tableId);
    if (!table) continue;
    table.rows = [...t.rows, ...table.rows];
    table.sources = [...new Set([...table.sources, ...t.sources])];
  }
  if (next.mapPoints.length && !next.layout.some((s) => s.type === "map") && next.location) {
    next.layout.splice(2, 0, { type: "map", title: "Map", tableId: null });
  }
  return sanitize(next, sources);
}

export function sanitize(spec: BoardSpec, sources: Source[]): BoardSpec {
  const known = new Set(sources.map((s) => s.id));
  const clean = (ids: string[]) => [...new Set(ids.filter((id) => known.has(id)))];
  const uniq = <T extends { id: string }>(items: T[]) => {
    const seen = new Set<string>();
    return items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  };
  const s = structuredClone(spec);
  s.summary.sources = clean(s.summary.sources);
  s.kpis = uniq(s.kpis).map((k) => ({ ...k, sources: clean(k.sources) }));
  s.timeline = uniq(s.timeline)
    .map((t) => ({ ...t, sources: clean(t.sources) }))
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  s.mapPoints = uniq(s.mapPoints)
    .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon) && Math.abs(m.lat) <= 90 && Math.abs(m.lon) <= 180)
    .map((m) => ({ ...m, sources: clean(m.sources) }));
  s.tables = uniq(s.tables).map((t) => ({ ...t, sources: clean(t.sources) }));
  s.advisories = uniq(s.advisories).map((a) => ({ ...a, sources: clean(a.sources) }));
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  };
  const hosts = new Set(sources.map((x) => host(x.url)).filter(Boolean));
  const corpus = sources.map((x) => `${x.url} ${x.snippet ?? ""}`).join(" ").toLowerCase();
  s.help = uniq(s.help).filter((h) => {
    const hh = host(h.url);
    return !!hh && /^https?:\/\//.test(h.url) && (hosts.has(hh) || corpus.includes(hh));
  });
  const tableIds = new Set(s.tables.map((t) => t.id));
  const layout = s.layout.filter((sec) => {
    if (sec.type === "table") return !!sec.tableId && tableIds.has(sec.tableId);
    if (sec.type === "map") return s.mapPoints.length > 0 || !!s.location;
    return true;
  });
  const seen = new Set<string>();
  s.layout = layout.filter((sec) => {
    const key = sec.type === "table" ? `table:${sec.tableId}` : sec.type;
    return seen.has(key) ? false : (seen.add(key), true);
  });
  for (const type of ["news", "changes", "sources"] as const) {
    if (!s.layout.some((x) => x.type === type)) {
      s.layout.push({ type, title: type === "news" ? "Latest coverage" : type === "changes" ? "What changed" : "Sources", tableId: null });
    }
  }
  return s;
}
