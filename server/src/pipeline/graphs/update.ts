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
import { geocodeBoard, placeCountry, type GeocodeResult } from "../nodes/geocode";
import { oxylabsEnabled, oxySearch } from "../../oxylabs";
import { getBoardLayout } from "../../repo/board-layouts";
import { listMonitors, listSources, markChanged, markMonitorsSynced, saveBoardVersion } from "../../repo/boards";
import { recordContextChanges, recordContextSearch } from "../../repo/context-evidence";
import { listFacts } from "../../repo/facts";
import { incidentReporting, type FactDiff } from "../../spec";
import { incidentReportQuery, withIncidentReporting } from "../incident-reporting";
import { diffData, type HeaderOverrides } from "../assemble";
import { assess, materiality, type Assessment, type Materiality } from "../nodes/assess";
import { dedupeDocs, gather, localSearchQueries, rotateQueries } from "../nodes/gather";
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
  recordBoardCheck,
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
  // A paused board only reads the web for monitor webhooks, discovery matches and the build's follow-up.
  if (board.tier === "paused" && (reason === "schedule" || reason === "manual")) return;
  const settings = (await getBoardLayout(board.id)).assignment?.settings ?? null;
  const category = board.topicCategoryOverride ?? (board.spec.template === "finance" ? "economy" : board.plan.crisisType);
  const reporting = incidentReporting(settings, category);
  const { plan, spec: reportSpec } = withIncidentReporting(board.plan, board.spec, reporting);
  const reportSpecChanged = reportSpec !== board.spec;
  const now = Date.now();
  // A follow-up (queued by the build for questions it could not answer) searches its own queries over the plan's window.
  const followup = reason === "followup";
  const since = followup ? now - plan.lookbackDays * 86_400_000 : (board.lastPolledAt ?? now - 86_400_000) - 60 * 60_000;
  // The rotation advances once per poll interval of the board's tier, so a slower tier still cycles through every query.
  const period = POLL_INTERVAL_MS[board.tier === "paused" ? "hot" : board.tier];
  const queries = followup ? (payload.newsQueries ?? []).slice(0, 3) : rotateQueries(plan.newsQueries, now, period);
  const webQueries = followup ? (payload.webQueries ?? []).slice(0, 3) : [];
  if ((reporting.status || reporting.tally) && reason === "schedule") {
    webQueries.push(incidentReportQuery(plan, reporting.domains));
  }
  const freshness = plan.lookbackDays <= 1 ? "last_24_hours" : plan.lookbackDays <= 7 ? "last_week" : "last_month";
  // One Oxylabs local search per scheduled poll, rotating through the local-language and first web query.
  // The country comes from the geocoder; without it (or without a key) nothing runs.
  const placeName = plan.location?.name;
  // Reads of local pages are routed through the country on every poll; the local search runs on scheduled polls only.
  const readCountry = placeName && oxylabsEnabled() ? await placeCountry(placeName).catch(() => null) : null;
  const country = followup ? null : readCountry;
  const localQuery = country ? (rotateQueries(localSearchQueries(plan), now, period, 1)[0] ?? null) : null;

  const collected = await ctx.step(
    "collect",
    { queries, webQueries, since, ...(localQuery ? { localQuery, country } : {}) },
    async (i, use, signal) => {
      const failures: string[] = [];
      let contextSearchIncomplete = false;
      const archive = async (docs: FoundDoc[], pageIndex = 0) => {
        if (pageIndex > 0) use.context(1);
        await recordContextSearch(ctx.boardId, docs);
      };
      const localP = localQuery && country
        ? oxySearch(localQuery, { location: country, maxResults: 8, signal }).catch((e) => {
            failures.push(`Local search from ${country} failed: ${(e as Error).message}`);
            return [] as FoundDoc[];
          })
        : Promise.resolve([] as FoundDoc[]);
      const newsP = Promise.all([
        ...i.queries.map((q) =>
          searchNews(q, i.since, 10, signal, archive).catch((e) => {
            contextSearchIncomplete = true;
            failures.push(`News poll failed: ${(e as Error).message}`);
            return [] as FoundDoc[];
          }),
        ),
        ...i.webQueries.map((q) =>
          searchWeb(q, freshness, 6, signal, archive).catch((e) => {
            contextSearchIncomplete = true;
            failures.push(`Web search failed: ${(e as Error).message}`);
            return [] as FoundDoc[];
          }),
        ),
      ]);
      use.context(i.queries.length + i.webQueries.length);
      const socialP = gather({ newsQueries: [], webQueries: [], socialQueries: followup ? [] : plan.socialQueries, lookbackDays: plan.lookbackDays }, use, signal,
        { boardId: ctx.boardId, polling: true, tier: board.tier });
      const [news, social, m, local] = await Promise.all([
        newsP,
        socialP,
        collectMonitorChanges(ctx.boardId, signal, (changes) => recordContextChanges(ctx.boardId, changes)),
        localP,
      ]);
      failures.push(...social.failures);
      use.context(m.calls);
      // Monitor docs carry raw page text only; the judge model's summary goes to the change event, not to sources.
      const filled = await fetchChangeTexts(dedupeDocs(m.changes.flatMap(changeDocs)), signal);
      use.context(filled.calls);
      return {
        // Oxylabs last, so a URL Context.dev also found stays a Context.dev source.
        docs: dedupeDocs([...filled.docs, ...news.flat(), ...social.docs, ...local]),
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
        contextSearchIncomplete,
      };
    },
    { timeoutMs: 180_000, retries: 1 },
  );
  for (const f of collected.failures) await ctx.event("error", f);
  for (const { id: _id, monitorId: _m, detectedAt: _d, ...c } of collected.changes) await ctx.event("change", `Monitor: ${c.title}`, c);

  // Known URLs a monitor saw change are refreshed first, so ingest only adds URLs the board does not have yet.
  const refreshed = await refreshRound(ctx, collected.docs);
  const added = await ingest(ctx, collected.docs);
  const finish = async (message: string | null) => {
    if (!collected.contextSearchIncomplete) await recordBoardCheck(ctx);
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
  // On first setup, revisit official documents the current search found before the new tables existed.
  const searchedUrls = new Set(collected.docs.map((doc) => doc.url));
  const existingOfficial = reportSpecChanged
    ? (await listSources(ctx.boardId))
        .filter((source) => source.sourceType === "official" && (source.relevance ?? 0) > 0 && searchedUrls.has(source.url))
        .slice(0, 4)
    : [];
  // Sources stored before this poll but never triaged (discovery adds its evidence, then queues this poll) still count.
  const waiting = added.length === 0 && refreshed.length === 0 ? untriaged(await listSources(ctx.boardId)).length : 0;
  if (!reportSpecChanged && added.length === 0 && refreshed.length === 0 && waiting === 0) {
    return finish(reason === "discover" ? null : "Checked the web: nothing new");
  }

  const tr = await triageRound(ctx, plan, "u1");
  const refreshedIds = new Set(refreshed.map((s) => s.id));
  // Refreshed sources keep their triage unless they had been discarded (those are triaged again above).
  const keptIds = new Set([...tr.kept, ...refreshed.filter((s) => (s.relevance ?? 0) > 0).map((s) => s.id)]);
  for (const source of existingOfficial) keptIds.add(source.id);
  const found = added.length + refreshed.length + waiting;
  if (!reportSpecChanged && keptIds.size === 0) return finish(`Checked the web: ${found} new or changed results, none about this crisis`);
  const hasFacts = hasFactsMap(tr.rows);
  const fresh = (await listSources(ctx.boardId)).filter((s) => keptIds.has(s.id));
  // Pages a monitor saw change are read again without cache: the stored text predates the change.
  const reread = fresh.filter((s) => refreshedIds.has(s.id) || s.kind === "monitor").map((s) => s.id);
  const rereadSet = new Set(reread);
  await readRound(ctx, "u1", fresh.filter((s) => s.sourceType === "official" || rereadSet.has(s.id)), Math.min(4, 2 + reread.length), reread, readCountry);
  const picked = await extractable(ctx, hasFacts, 15, keptIds);
  const reprocess = existingOfficial.filter((source) => !picked.some(({ id }) => id === source.id));
  const out = await extractRound(ctx, plan, "u1", [...reprocess, ...picked].slice(0, 15));
  const diff = await mergeRound(ctx, plan, "u1", out);
  // Social facts never enter the diff, so a round that staged some still recomposes the unverified widget.
  // Only this round counts: a board that merely holds older social sources must not save a version per poll.
  const unchanged = `Read ${keptIds.size} new or changed sources, nothing on the board changed`;
  const socialOnly = emptyDiff(diff);
  if (!reportSpecChanged && socialOnly && !out.staged.some((f) => f.sourceType === "social")) return finish(unchanged);

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
    ctx.step("note", { diff: trustedDiff }, (i, use, signal) => lines.length ? changeNote(plan, i.diff, lines, use, signal) : Promise.resolve(reportSpecChanged ? "Official incident reporting enabled" : "On the ground: unverified social reports updated"), {
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
  const { spec, data } = await composeData(ctx, plan, reportSpec, board.data, overrides);
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
  if (!collected.contextSearchIncomplete) await recordBoardCheck(ctx);
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
