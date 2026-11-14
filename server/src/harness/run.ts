import { generateText, Output } from "ai";
import { z } from "zod";
import {
  addEvent,
  addMessage,
  discardSources,
  addSources,
  getRow,
  listMessages,
  listMonitors,
  listSources,
  markPolled,
  saveMetrics,
  saveMonitor,
  savePlan,
  saveSpec,
  setMonitorSeen,
  setStatus,
} from "../boards";
import { createSearchMonitor, ctx, searchNews, type FoundDoc } from "../contextdev";
import { fastLlm } from "../llm";
import { publish } from "../bus";
import { applyPatch, composeBoard, patchBoard } from "./compose";
import { gather } from "./gather";
import { makePlan, type Plan } from "./plan";
import type { BoardMetrics } from "../spec";

const running = new Set<string>();

async function programOf(boardId: string) {
  const msgs = (await listMessages(boardId)).filter((m) => m.role === "user");
  if (msgs.length === 0) return "";
  const [first, ...edits] = msgs;
  return edits.length
    ? `${first.content}\n\nLater instructions from the user (newest last, they override earlier ones):\n${edits.map((m) => `- ${m.content}`).join("\n")}`
    : first.content;
}

async function timed<T>(metrics: BoardMetrics, stage: string, fn: () => Promise<T>, detail: (r: T) => string) {
  const t0 = Date.now();
  const r = await fn();
  const ms = Date.now() - t0;
  metrics.stages.push({ stage, ms, detail: detail(r) });
  return r;
}

export function buildBoard(boardId: string) {
  if (running.has(boardId)) return;
  running.add(boardId);
  void runBuild(boardId).finally(() => running.delete(boardId));
}

async function runBuild(boardId: string) {
  const metrics: BoardMetrics = { stages: [], contextCalls: 0, llmCalls: 0, sourcesRead: 0 };
  const program = await programOf(boardId);
  try {
    await setStatus(boardId, "planning");
    await addEvent(boardId, "stage", "Compiling the prompt into a plan");
    const plan = await timed(metrics, "plan", () => makePlan(program), (p) => `${p.newsQueries.length} news + ${p.webQueries.length} web queries, ${p.sections.length} sections`);
    metrics.llmCalls += 1;
    await savePlan(boardId, plan);
    await addEvent(boardId, "stage", `Plan ready: ${plan.title}`, { plan });

    await setStatus(boardId, "gathering");
    await addEvent(boardId, "stage", "Reading the live web with Context.dev");
    const g = await timed(metrics, "gather", () => gather(plan), (r) => `${r.docs.length} documents from ${r.calls} calls`);
    metrics.contextCalls += g.calls;
    for (const f of g.failures) await addEvent(boardId, "error", f);
    await addSources(boardId, g.docs);
    const sources = await listSources(boardId);
    metrics.sourcesRead = sources.length;
    await addEvent(boardId, "stage", `Read ${sources.length} sources`);

    await setStatus(boardId, "composing");
    await addEvent(boardId, "stage", "Composing the board from sources");
    const spec = await timed(metrics, "compose", () => composeBoard(program, plan, sources, (spec) => publish({ type: "partial", boardId, spec })), (s) => `${s.layout.length} sections, ${s.kpis.length} KPIs, ${s.timeline.length} events`);
    metrics.llmCalls += 1;
    await saveSpec(boardId, spec, "watching");
    await saveMetrics(boardId, metrics);

    await addEvent(boardId, "stage", "Setting up live monitoring");
    await timed(metrics, "watch", () => ensureMonitor(boardId, plan), (r) => r);
    await markPolled(boardId);
    await saveMetrics(boardId, metrics);
    await setStatus(boardId, "live");
    const total = metrics.stages.reduce((a, s) => a + s.ms, 0);
    await addEvent(boardId, "stage", `Board live in ${(total / 1000).toFixed(1)}s`, { metrics });
    await addMessage(boardId, "assistant", `Built "${spec.title}" from ${sources.length} live sources in ${(total / 1000).toFixed(1)}s.`);
  } catch (e) {
    console.error("build failed", boardId, e);
    await addEvent(boardId, "error", `Build failed: ${(e as Error).message}`);
    await saveMetrics(boardId, metrics);
    await setStatus(boardId, "error");
  }
}

async function ensureMonitor(boardId: string, plan: Plan): Promise<string> {
  if ((await listMonitors(boardId)).length > 0) return "monitor already running";
  try {
    const limits = await ctx().monitors.getLimits();
    if (limits.monitors_used >= limits.monitors_limit) {
      await addEvent(boardId, "info", "Monitor limit reached, using news polling only");
      return "polling only (monitor limit reached)";
    }
    const m = await createSearchMonitor(`faraday ${plan.title}`, plan.monitor.query, plan.monitor.instructions);
    await saveMonitor(m.id, boardId, "search", plan.monitor.query, m.webhook?.secret ?? null);
    await addEvent(boardId, "info", `Watching the web every 10 minutes for: ${plan.monitor.query}`);
    return `search monitor ${m.id}`;
  } catch (e) {
    await addEvent(boardId, "error", `Monitor setup failed: ${(e as Error).message}`);
    return "monitor failed, polling only";
  }
}

const editSchema = z.object({
  reply: z.string().describe("One or two sentences to the user about what will change"),
  newsQueries: z.array(z.string()).describe("Extra news queries needed for the change, empty if none"),
  webQueries: z.array(z.string()).describe("Extra web queries needed for the change, empty if none"),
});

export function editBoard(boardId: string, instruction: string) {
  if (running.has(boardId)) return false;
  running.add(boardId);
  void addMessage(boardId, "user", instruction)
    .then(() => runEdit(boardId, instruction))
    .finally(() => running.delete(boardId));
  return true;
}

async function runEdit(boardId: string, instruction: string) {
  const row = await getRow(boardId);
  if (!row?.plan || !row.spec) return;
  const metrics: BoardMetrics = row.metrics ?? { stages: [], contextCalls: 0, llmCalls: 0, sourcesRead: 0 };
  try {
    await setStatus(boardId, "planning");
    await addEvent(boardId, "edit", `Editing the program: ${instruction}`);
    const { output } = await generateText({
      ...fastLlm(),
      output: Output.object({ schema: editSchema }),
      system: `A user is editing a live crisis dashboard by instruction. Decide which extra web data is needed. Today is ${new Date().toISOString().slice(0, 10)}.`,
      prompt: `PLAN:\n${JSON.stringify(row.plan)}\n\nBOARD SECTIONS: ${row.spec.layout.map((s) => s.title).join(", ")}\n\nINSTRUCTION: ${instruction}`,
    });
    metrics.llmCalls += 1;
    const plan: Plan = {
      ...row.plan,
      newsQueries: [...row.plan.newsQueries, ...output.newsQueries],
      webQueries: [...row.plan.webQueries, ...output.webQueries],
    };
    await savePlan(boardId, plan);
    if (output.newsQueries.length + output.webQueries.length > 0) {
      await setStatus(boardId, "gathering");
      const g = await gather({ ...plan, newsQueries: output.newsQueries, webQueries: output.webQueries });
      metrics.contextCalls += g.calls;
      const added = await addSources(boardId, g.docs);
      await addEvent(boardId, "stage", `Read ${added.length} new sources for the edit`);
    }
    await setStatus(boardId, "composing");
    const sources = await listSources(boardId);
    const spec = await composeBoard(await programOf(boardId), plan, sources, (p) => publish({ type: "partial", boardId, spec: p }));
    metrics.llmCalls += 1;
    metrics.sourcesRead = sources.length;
    await saveSpec(boardId, spec, "live");
    await saveMetrics(boardId, metrics);
    await addMessage(boardId, "assistant", output.reply);
    await addEvent(boardId, "edit", output.reply);
  } catch (e) {
    await addEvent(boardId, "error", `Edit failed: ${(e as Error).message}`);
    await setStatus(boardId, "live");
  }
}

export async function pollBoard(boardId: string, reason: "schedule" | "manual" = "schedule") {
  if (running.has(boardId)) return { added: 0 };
  running.add(boardId);
  try {
    return await runPoll(boardId, reason);
  } finally {
    running.delete(boardId);
  }
}

async function runPoll(boardId: string, reason: string) {
  const row = await getRow(boardId);
  if (!row?.plan || !row.spec) return { added: 0 };
  const since = (row.last_polled_at ?? Date.now() - 86_400_000) - 60 * 60_000;
  const docs: FoundDoc[] = [];
  let calls = 0;

  for (const q of row.plan.newsQueries.slice(0, 2)) {
    calls += 1;
    try {
      docs.push(...(await searchNews(q, since, 10)));
    } catch (e) {
      await addEvent(boardId, "error", `News poll failed: ${(e as Error).message}`);
    }
  }

  for (const m of await listMonitors(boardId)) {
    calls += 1;
    try {
      const page = await ctx().monitors.listChanges(m.id, { limit: 20 });
      const fresh = page.data.filter((c) => !m.last_seen_change_at || c.detected_at > m.last_seen_change_at);
      if (fresh.length) await setMonitorSeen(m.id, fresh[0].detected_at);
      for (const c of fresh) {
        await addEvent(boardId, "change", `Monitor: ${c.title}`, { summary: c.summary, url: c.url, importance: "importance" in c ? c.importance : null });
        docs.push({ url: c.url, title: c.title, publisher: hostOf(c.url), publishedAt: c.detected_at, snippet: c.summary, kind: "monitor" });
        const evidence = "evidence" in c && Array.isArray(c.evidence) ? c.evidence : [];
        for (const ev of evidence as { url?: string; after?: string }[]) {
          if (ev.url) docs.push({ url: ev.url, title: null, publisher: hostOf(ev.url), publishedAt: null, snippet: ev.after ?? null, kind: "monitor" });
        }
      }
    } catch (e) {
      await addEvent(boardId, "error", `Monitor poll failed: ${(e as Error).message}`);
    }
  }

  await markPolled(boardId);
  const terms = keyTerms(row.plan);
  const onTopic = docs.filter((d) => d.kind === "monitor" || matchesTerms(`${d.title ?? ""} ${d.snippet ?? ""}`, terms));
  const added = await addSources(boardId, onTopic);
  const metrics = row.metrics ?? { stages: [], contextCalls: 0, llmCalls: 0, sourcesRead: 0 };
  metrics.contextCalls += calls;
  if (added.length === 0) {
    await saveMetrics(boardId, metrics);
    if (reason === "manual") await addEvent(boardId, "info", "Checked the web: nothing new");
    return { added: 0 };
  }
  await addEvent(boardId, "info", `Found ${added.length} new sources, checking what changed`);
  const t0 = Date.now();
  const patch = await patchBoard(row.spec, added);
  metrics.llmCalls += 1;
  const dropped = patch.irrelevantSourceIds.filter((id) => added.some((s) => s.id === id));
  if (dropped.length) await discardSources(boardId, dropped);
  const sources = await listSources(boardId);
  metrics.sourcesRead = sources.length;
  await saveMetrics(boardId, metrics);
  if (!patch.changed) {
    await addEvent(boardId, "info", `New sources read, board unchanged (${patch.changeNote})`);
    await saveSpec(boardId, row.spec);
    return { added: added.length };
  }
  const next = applyPatch(row.spec, patch, sources);
  await saveSpec(boardId, next);
  await addEvent(boardId, "update", patch.changeNote, { ms: Date.now() - t0, sources: added.map((s) => s.id) });
  return { added: added.length };
}

export async function refreshBoard(boardId: string) {
  for (const m of await listMonitors(boardId)) {
    try {
      await ctx().monitors.run(m.id);
    } catch {}
  }
  return pollBoard(boardId, "manual");
}

const STOP = new Set(["the", "and", "for", "with", "from", "what", "where", "when", "which", "this", "that", "latest", "update", "updates", "news", "live", "global", "official", "status", "near", "after", "over", "into", "more"]);

function keyTerms(plan: Plan): string[] {
  const text = [plan.title, plan.location?.name ?? "", plan.monitor.query].join(" ").toLowerCase();
  const words = text.match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w) && !/^\d{4}$/.test(w)))];
}

function matchesTerms(text: string, terms: string[]) {
  const t = text.toLowerCase();
  const hits = terms.filter((w) => t.includes(w)).length;
  return hits >= Math.min(2, terms.length);
}

function hostOf(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
