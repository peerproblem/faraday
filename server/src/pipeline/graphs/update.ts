import { trustedFacts } from "../trust";
import type { GraphFn } from "../../graph/runner";
import {
  ackChanges,
  changeDocs,
  collectMonitorChanges,
  ensureBoardMonitors,
  fetchChangeTexts,
  MONITOR_SYNC_MS,
  syncBoardMonitors,
  type SyncResult,
} from "../../monitors";
import { searchNews, searchWeb, type FoundDoc } from "../../contextdev";
import { geocodeBoard, type GeocodeResult } from "../nodes/geocode";
import { listMonitors, listSources, markChanged, markMonitorsSynced, markPolled, saveBoardVersion } from "../../repo/boards";
import { listFacts } from "../../repo/facts";
import type { FactDiff } from "../../spec";
import { diffData, type HeaderOverrides } from "../assemble";
import { assess, materiality, type Assessment, type Materiality } from "../nodes/assess";
import { dedupeDocs, gather, rotateQueries } from "../nodes/gather";
import { writeNarrative, type Narrative } from "../nodes/narrative";
import { changeNote } from "../nodes/note";
import { untriaged } from "../nodes/triage";
import { factLine, POLL_INTERVAL_MS } from "../nodes/util";
import {
  composeData,
  extractable,
  extractRound,
  hasFactsMap,
  ingest,
  loadBoard,
  mergeRound,
  officialUrls,
  readRound,
  refreshRound,
  triageRound,
} from "./common";

type Reason = "schedule" | "manual" | "webhook" | "followup" | "discover";

export const emptyDiff = (d: FactDiff) => d.added.length === 0 && d.changed.length === 0;

export const updateGraph: GraphFn = async (ctx) => {
  const payload = (ctx.job.payload ?? {}) as { reason?: Reason; newsQueries?: string[]; webQueries?: string[] };
  const reason = (payload.reason ?? "schedule") as Reason;
  const board = await loadBoard(ctx);
  if (!board.plan || !board.spec || board.specVersion !== 2 || board.status !== "live") return;
  if (board.tier === "paused" && reason === "schedule") return;
  const plan = board.plan;
  const now = Date.now();
  // A follow-up (queued by the build for questions it could not answer) searches its own queries over the plan's window.
  const followup = reason === "followup";
  const since = followup ? now - plan.lookbackDays * 86_400_000 : (board.lastPolledAt ?? now - 86_400_000) - 60 * 60_000;
  const queries = followup ? (payload.newsQueries ?? []).slice(0, 3) : rotateQueries(plan.newsQueries, now, POLL_INTERVAL_MS.hot);
  const webQueries = followup ? (payload.webQueries ?? []).slice(0, 3) : [];
  const freshness = plan.lookbackDays <= 1 ? "last_24_hours" : plan.lookbackDays <= 7 ? "last_week" : "last_month";

  const collected = await ctx.step(
    "collect",
    { queries, webQueries, since },
    async (i, use, signal) => {
      const failures: string[] = [];
      const newsP = Promise.all([
        ...i.queries.map((q) =>
          searchNews(q, i.since, 10, signal).catch((e) => {
            failures.push(`News poll failed: ${(e as Error).message}`);
            return [] as FoundDoc[];
          }),
        ),
        ...i.webQueries.map((q) =>
          searchWeb(q, freshness, 6, signal).catch((e) => {
            failures.push(`Web search failed: ${(e as Error).message}`);
            return [] as FoundDoc[];
          }),
        ),
      ]);
      use.context(i.queries.length + i.webQueries.length);
      const socialP = gather({ newsQueries: [], webQueries: [], socialQueries: followup ? [] : plan.socialQueries, lookbackDays: plan.lookbackDays }, use, signal,
        { boardId: ctx.boardId, polling: true, tier: board.tier });
      const [news, social, m] = await Promise.all([newsP, socialP, collectMonitorChanges(ctx.boardId, signal)]);
      failures.push(...social.failures);
      use.context(m.calls);
      // Monitor docs carry raw page text only; the judge model's summary goes to the change event, not to sources.
      const filled = await fetchChangeTexts(dedupeDocs(m.changes.flatMap(changeDocs)), signal);
      use.context(filled.calls);
      return {
        docs: dedupeDocs([...filled.docs, ...news.flat(), ...social.docs]),
        changes: m.changes.map((c) => ({
          id: c.id,
          monitorId: c.monitorId,
          detectedAt: c.detectedAt,
          title: c.title,
          summary: c.summary,
          url: c.url,
          importance: c.importance,
        })),
        failures,
      };
    },
    { timeoutMs: 60_000, retries: 1 },
  );
  for (const f of collected.failures) await ctx.event("error", f);
  for (const { id: _id, monitorId: _m, detectedAt: _d, ...c } of collected.changes) await ctx.event("change", `Monitor: ${c.title}`, c);

  // Known URLs a monitor saw change are refreshed first, so ingest only adds URLs the board does not have yet.
  const refreshed = await refreshRound(ctx, collected.docs);
  const added = await ingest(ctx, collected.docs);
  const finish = async (message: string | null) => {
    await markPolled(ctx.boardId);
    await ackChanges(collected.changes);
    if (message && reason !== "schedule") await ctx.event("info", message);
    await maintainMonitors();
  };
  // Creates missing monitors, and at most every MONITOR_SYNC_MS checks health, settings and the tier's schedule.
  const maintainMonitors = async () => {
    if (board.tier === "paused") return;
    const rows = await listMonitors(ctx.boardId);
    const sinceSync = board.monitorsSyncedAt === null || board.monitorsSyncedAt === undefined ? Infinity : now - board.monitorsSyncedAt;
    // No monitors yet (or all gone): retry creation every 5 minutes instead of waiting for the full interval.
    if (sinceSync < MONITOR_SYNC_MS && (rows.length > 0 || sinceSync < 5 * 60_000)) return;
    const sources = await listSources(ctx.boardId);
    const r = await ctx.step(
      "watch",
      { n: sources.length, monitors: rows.length },
      async () => {
        const sync: SyncResult = rows.length ? await syncBoardMonitors(ctx.boardId, plan, board.tier) : { notes: [], alerts: [] };
        const note = await ensureBoardMonitors(ctx.boardId, plan, officialUrls(sources), { allowPage: board.tier === "hot", tier: board.tier });
        await markMonitorsSynced(ctx.boardId);
        return { note: [...sync.notes, note].filter(Boolean).join("; "), alerts: sync.alerts };
      },
      { timeoutMs: 45_000, optional: true, fallback: { note: "monitor setup failed", alerts: [] as string[] } },
    );
    for (const a of r.alerts) await ctx.event("info", a);
  };
  // Sources stored before this poll but never triaged (discovery adds its evidence, then queues this poll) still count.
  const waiting = added.length === 0 && refreshed.length === 0 ? untriaged(await listSources(ctx.boardId)).length : 0;
  if (added.length === 0 && refreshed.length === 0 && waiting === 0) {
    return finish(reason === "discover" ? null : "Checked the web: nothing new");
  }

  const tr = await triageRound(ctx, plan, "u1");
  const refreshedIds = new Set(refreshed.map((s) => s.id));
  // Refreshed sources keep their triage unless they had been discarded (those are triaged again above).
  const keptIds = new Set([...tr.kept, ...refreshed.filter((s) => (s.relevance ?? 0) > 0).map((s) => s.id)]);
  const found = added.length + refreshed.length + waiting;
  if (keptIds.size === 0) return finish(`Checked the web: ${found} new or changed results, none about this crisis`);
  const hasFacts = hasFactsMap(tr.rows);
  const fresh = (await listSources(ctx.boardId)).filter((s) => keptIds.has(s.id));
  // Pages a monitor saw change are read again without cache: the stored text predates the change.
  const reread = fresh.filter((s) => refreshedIds.has(s.id) || s.kind === "monitor").map((s) => s.id);
  const rereadSet = new Set(reread);
  await readRound(ctx, "u1", fresh.filter((s) => s.sourceType === "official" || rereadSet.has(s.id)), Math.min(4, 2 + reread.length), reread);
  const picked = await extractable(ctx, hasFacts, 15, keptIds);
  const out = await extractRound(ctx, plan, "u1", picked);
  const diff = await mergeRound(ctx, plan, "u1", out);
  // Social facts never enter the diff, so a round that staged some still recomposes the unverified widget.
  // Only this round counts: a board that merely holds older social sources must not save a version per poll.
  const unchanged = `Read ${keptIds.size} new or changed sources, nothing on the board changed`;
  const socialOnly = emptyDiff(diff);
  if (socialOnly && !out.staged.some((f) => f.sourceType === "social")) return finish(unchanged);

  const facts = trustedFacts(await listFacts(ctx.boardId, { status: ["active"] }), await listSources(ctx.boardId, { includeDiscarded: true }));
  const touched = new Set([...diff.added, ...diff.changed].map((d) => `${d.kind}:${d.key}`));
  const lines = facts.filter((f) => touched.has(`${f.kind}:${f.key}`)).map(factLine);
  const trustedKeys = new Set(facts.map((f) => `${f.kind}:${f.key}`));
  const trustedDiff = { added: diff.added.filter((d) => trustedKeys.has(`${d.kind}:${d.key}`)),
    changed: diff.changed.filter((d) => trustedKeys.has(`${d.kind}:${d.key}`)), superseded: diff.superseded };
  const mat = await ctx.step("materiality", { diff: trustedDiff }, (i, use, signal) => lines.length ? materiality(board.data?.header ?? null, i.diff, lines, use, signal) : Promise.resolve({ material: false, probability: 0, importance: "low" } as Materiality), {
    timeoutMs: 20_000,
    optional: true,
    fallback: { material: true, probability: 1, importance: "medium" } as Materiality,
  });

  const [narrative, assessment, note] = await Promise.all([
    mat.material && facts.length > 0
      ? ctx.step("narrative", { n: facts.length, diff }, (_i, use, signal) => writeNarrative(plan, facts, use, signal), {
          timeoutMs: 60_000,
          optional: true,
          fallback: null as Narrative | null,
        })
      : Promise.resolve(null),
    mat.material && facts.length > 0
      ? ctx.step("assess", { n: facts.length, diff }, (_i, use, signal) => assess(plan, facts, use, signal), {
          timeoutMs: 20_000,
          optional: true,
          fallback: null as Assessment | null,
        })
      : Promise.resolve(null),
    ctx.step("note", { diff: trustedDiff }, (i, use, signal) => lines.length ? changeNote(plan, i.diff, lines, use, signal) : Promise.resolve("On the ground: unverified social reports updated"), {
      timeoutMs: 20_000,
      optional: true,
      fallback: "New information arrived",
    }),
  ]);
  const overrides: HeaderOverrides = {
    ...(narrative ? { headline: narrative.headline, narrative: narrative.sentences } : {}),
    ...(assessment ? { assessment } : {}),
  };
  // New places need coordinates before they can go on the map, and a board whose location lookup failed at build
  // time gets another try. Coordinates are written to the facts, so they are re-read below.
  if (diff.added.some((d) => d.kind === "place") || (plan.location && !board.data?.header.location)) {
    const geo = await ctx.step("geocode", { n: facts.length }, (_i, _use, signal) => geocodeBoard(plan, facts, signal), {
      timeoutMs: 30_000,
      optional: true,
      fallback: { location: null, placed: 0, missed: 0 } as GeocodeResult,
    });
    if (geo.location) overrides.location = geo.location;
  }
  const { spec, data } = await composeData(ctx, plan, board.spec, board.data, overrides);
  const changed = diffData(board.data, data);
  // The staged social reports were duplicates or got corroborated away: nothing to publish.
  if (socialOnly && !changed.widgets.length && !changed.header && !changed.hidden && JSON.stringify(spec) === JSON.stringify(board.spec)) return finish(unchanged);
  const version = await saveBoardVersion(ctx.boardId, { spec, data, changeNote: note });
  if (JSON.stringify(spec) !== JSON.stringify(board.spec)) ctx.emit({ type: "spec", version, spec });
  ctx.emit({
    type: "data",
    version,
    ...(changed.header ? { header: data.header } : {}),
    widgets: Object.fromEntries(changed.widgets.filter((id) => id in data.widgets).map((id) => [id, data.widgets[id]])),
    ...(changed.hidden ? { hidden: data.hidden } : {}),
  });
  await markChanged(ctx.boardId);
  await markPolled(ctx.boardId);
  await ackChanges(collected.changes);
  await ctx.event("update", note, {
    importance: mat.importance,
    material: mat.material,
    sources: out.sourceIds,
    added: diff.added.length,
    changed: diff.changed.length,
    silent: mat.importance === "low",
  });
  await maintainMonitors();
};
