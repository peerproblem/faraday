import { trustedFacts } from "../trust";
import type { GraphFn, RunCtx } from "../../graph/runner";
import { ensureBoardMonitors } from "../../monitors";
import { addMessage, listMessages, listSources, markMonitorsSynced, markPolled, saveBoardVersion, savePlan, setSchedule } from "../../repo/boards";
import { listFacts } from "../../repo/facts";
import { enqueue } from "../../repo/jobs";
import type { BoardSpecV2, Fact, Plan, StagedFact } from "../../spec";
import { assemble, specFromPlan, type HeaderOverrides } from "../assemble";
import { assess, type Assessment } from "../nodes/assess";
import { checkCoverage, followUpQueries } from "../nodes/coverage";
import { gather } from "../nodes/gather";
import { geocodeBoard, placeCountry, type GeocodeResult } from "../nodes/geocode";
import { writeNarrative, type Narrative } from "../nodes/narrative";
import { makePlan } from "../nodes/plan";
import { oxylabsEnabled } from "../../oxylabs";
import { pickReadTargets } from "../nodes/read";
import { LIMITS, POLL_INTERVAL_MS, programOf } from "../nodes/util";
import {
  composeData,
  extractable,
  extractRound,
  hasFactsMap,
  ingest,
  loadBoard,
  mergeOpts,
  mergeRound,
  officialUrls,
  provisionalFacts,
  readRound,
  setBoardStatus,
  triageRound,
  type ExtractOutcome,
} from "./common";

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** gather -> ingest -> triage -> read -> extract (partials) -> merge. Returns the number of facts staged. */
async function collect(
  ctx: RunCtx,
  plan: Plan,
  spec: BoardSpecV2,
  round: string,
  queries: { newsQueries: string[]; webQueries: string[]; socialQueries?: string[]; localQueries?: string[] },
  hasFacts: Record<string, number>,
  opts: { scrapes: number; extractCap: number; partial: boolean; country?: string | null },
) {
  const t0 = Date.now();
  const country = opts.country ?? null;
  const g = await ctx.step(
    "gather",
    {
      round,
      newsQueries: queries.newsQueries,
      webQueries: queries.webQueries,
      socialQueries: queries.socialQueries,
      localQueries: queries.localQueries,
      country,
    },
    (_i, use, signal) => gather({ ...queries, lookbackDays: plan.lookbackDays }, use, signal, { boardId: ctx.boardId, country }),
    {
      key: round,
      timeoutMs: 75_000,
      retries: 1,
    },
  );
  for (const f of g.failures) await ctx.event("error", f);
  if (country && g.localFound > 0) {
    await ctx.event("stage", `Local search from ${country}: ${g.localFound} results, ${g.localAdded} sources global search missed`, {
      found: g.localFound,
      added: g.localAdded,
      calls: g.oxylabsCalls,
    });
  }
  const added = await ingest(ctx, g.docs);
  const tr = await triageRound(ctx, plan, round);
  hasFactsMap(tr.rows, hasFacts);
  const kept = (await listSources(ctx.boardId)).filter((s) => s.relevance !== null);
  await ctx.event("stage", `Read ${g.docs.length} results, kept ${tr.kept.length} on topic`, { ms: Date.now() - t0, dropped: tr.dropped.length });

  // Pages being read are extracted after their full text arrives; everything else is extracted while they load.
  const reading = new Set(pickReadTargets(kept, opts.scrapes).map((s) => s.id));
  const readP = readRound(ctx, round, kept, opts.scrapes, [], country);
  // Later rounds only extract what they added; the first round takes everything triaged (also old sources on a rebuild).
  const only = round === "r1" ? undefined : new Set(added.map((s) => s.id));
  const picked = await extractable(ctx, hasFacts, opts.extractCap, only);
  const current = await listFacts(ctx.boardId, { status: ["active"] });
  const trustSources = await listSources(ctx.boardId, { includeDiscarded: true });
  const mo = mergeOpts(trustSources);
  let lastEmit = 0;
  const onBatch = (staged: StagedFact[]) => {
    if (!opts.partial || Date.now() - lastEmit < 500) return;
    lastEmit = Date.now();
    try {
      const facts = provisionalFacts(ctx.boardId, current, staged, Date.now(), mo);
      const { spec: s, data } = assemble({
        plan,
        spec,
        facts,
        metricHistory: facts.filter((f): f is Fact<"metric"> => f.kind === "metric"),
        sources: trustSources,
        prev: null,
        overrides: {},
        now: Date.now(),
      });
      ctx.emit({ type: "partial", stage: "extract", spec: s, header: data.header, widgets: data.widgets });
    } catch {
      // Partial display is best effort.
    }
  };
  let earlyStaged: StagedFact[] = [];
  let lateStaged: StagedFact[] = [];
  // Full pages are long, so they go two per call and start the moment the reads finish.
  const [early, late] = await Promise.all([
    extractRound(ctx, plan, `${round}`, picked.filter((s) => !reading.has(s.id)), {
      onBatch: (s) => {
        earlyStaged = s;
        onBatch([...earlyStaged, ...lateStaged]);
      },
    }),
    readP.then(() =>
      extractRound(ctx, plan, `${round}-read`, picked.filter((s) => reading.has(s.id)), {
        batchSize: 2,
        onBatch: (s) => {
          lateStaged = s;
          onBatch([...earlyStaged, ...lateStaged]);
        },
      }),
    ),
  ]);
  const out: ExtractOutcome = {
    staged: [...early.staged, ...late.staged],
    rejected: [...early.rejected, ...late.rejected],
    sourceIds: [...early.sourceIds, ...late.sourceIds],
  };
  const diff = await mergeRound(ctx, plan, round, out);
  await ctx.event("stage", `Extracted ${out.staged.length} verified facts from ${picked.length} sources`, {
    ms: Date.now() - t0,
    rejected: out.rejected.length,
    added: diff.added.length,
  });
  return out.staged.length;
}

export const buildGraph: GraphFn = async (ctx) => {
  const started = Date.now();
  const board = await loadBoard(ctx);
  const program = programOf(await listMessages(ctx.boardId));
  if (!program) throw new Error("board has no prompt");

  await setBoardStatus(ctx, "planning", "hot");
  await ctx.event("stage", "Compiling the prompt into a plan");
  let t = Date.now();
  const plan = await ctx.step("plan", { program }, (i, use, signal) => makePlan(i.program, use, signal), { timeoutMs: 45_000, retries: 1 });
  await savePlan(ctx.boardId, plan);
  const spec = specFromPlan(plan);
  ctx.emit({
    type: "partial",
    stage: "plan",
    spec,
    header: { title: plan.title, subtitle: plan.subtitle, crisisType: plan.crisisType, language: plan.language },
  });
  await ctx.event("stage", `Plan ready: ${plan.title}`, { ms: Date.now() - t, metrics: plan.metrics.length, widgets: spec.widgets.length });

  await setBoardStatus(ctx, "gathering", "hot");
  await ctx.event("stage", "Reading the live web with Context.dev");
  const hasFacts: Record<string, number> = {};
  // The country comes from the geocoder, never from a model. Without it local search is skipped.
  const placeName = plan.location?.name;
  const country = placeName && oxylabsEnabled() ? await placeCountry(placeName).catch(() => null) : null;
  await collect(ctx, plan, spec, "r1", plan, hasFacts, {
    scrapes: LIMITS.maxScrapes(),
    extractCap: LIMITS.maxExtract(),
    partial: true,
    country,
  });

  await setBoardStatus(ctx, "composing", "hot");
  const facts = trustedFacts(await listFacts(ctx.boardId, { status: ["active"] }), await listSources(ctx.boardId, { includeDiscarded: true }));
  // Coverage runs beside the narrative. Open questions are searched by the first update after the board is live,
  // so a second gather round never delays the build (it cost ~48s on the critical path).
  const followupP: Promise<{ newsQueries: string[]; webQueries: string[] } | null> =
    plan.questions.length && facts.length
      ? (async () => {
          const cov = await ctx.step("coverage", { n: facts.length }, (_i, use, signal) => checkCoverage(plan, facts, use, signal), {
            timeoutMs: 30_000,
            optional: true,
            fallback: { answered: {}, unanswered: [] },
          });
          if (!cov.unanswered.length) return null;
          const q = await ctx.step(
            "followup",
            { open: cov.unanswered.map((x) => x.id) },
            (_i, use, signal) => followUpQueries(plan, cov.unanswered, use, signal),
            { timeoutMs: 20_000, optional: true, fallback: { newsQueries: [], webQueries: [] } },
          );
          return q.newsQueries.length + q.webQueries.length > 0 ? q : null;
        })()
      : Promise.resolve(null);

  t = Date.now();
  await ctx.event("stage", "Writing the summary");
  const narrativeId = spec.widgets.find((w) => w.type === "narrative")?.id;
  const [narrative, assessment, geo] = await Promise.all([
    ctx.step(
      "narrative",
      { n: facts.length },
      (_i, use, signal) =>
        writeNarrative(plan, facts, use, signal, (p) =>
          ctx.emit({
            type: "partial",
            stage: "narrative",
            header: p.headline ? { headline: p.headline } : undefined,
            widgets: narrativeId ? { [narrativeId]: { sentences: p.sentences } } : undefined,
          }),
        ),
      { timeoutMs: 60_000, retries: 1, optional: true, fallback: { headline: null, sentences: [] } as Narrative },
    ),
    ctx.step("assess", { n: facts.length }, (_i, use, signal) => facts.length ? assess(plan, facts, use, signal) : Promise.resolve(null), {
      timeoutMs: 20_000,
      optional: true,
      fallback: null as Assessment | null,
    }),
    ctx.step("geocode", { n: facts.length }, (_i, _use, signal) => geocodeBoard(plan, facts, signal), {
      timeoutMs: 30_000,
      optional: true,
      fallback: { location: null, placed: 0, missed: 0 } as GeocodeResult,
    }),
  ]);

  const overrides: HeaderOverrides = {
    headline: narrative.headline,
    narrative: narrative.sentences,
    ...(assessment ? { assessment } : {}),
    location: geo.location,
  };
  const { spec: finalSpec, data } = await composeData(ctx, plan, spec, board.data, overrides);
  await setBoardStatus(ctx, "watching", "hot");
  const version = await saveBoardVersion(ctx.boardId, { spec: finalSpec, data, changeNote: "Board built", status: "watching" });
  ctx.emit({ type: "spec", version, spec: finalSpec });
  ctx.emit({ type: "data", version, header: data.header, widgets: data.widgets, hidden: data.hidden });
  await ctx.event("stage", "Board written", { ms: Date.now() - t, placed: geo.placed });

  const sources = await listSources(ctx.boardId);
  await ctx.event("stage", "Setting up live monitoring");
  const note = await ctx.step("watch", { urls: officialUrls(sources) }, async (i) => {
    const n = await ensureBoardMonitors(ctx.boardId, plan, i.urls, { allowPage: true, tier: "hot" });
    await markMonitorsSynced(ctx.boardId);
    return n;
  }, {
    timeoutMs: 30_000,
    optional: true,
    deadlineExempt: true,
    fallback: "monitor setup failed, polling only",
  });
  await ctx.event("info", note);
  await markPolled(ctx.boardId);
  await setSchedule(ctx.boardId, { tier: "hot", nextPollAt: Date.now() + POLL_INTERVAL_MS.hot });
  await setBoardStatus(ctx, "live", "hot");
  const total = Date.now() - started;
  await ctx.event("stage", `Board live in ${secs(total)}`, { ms: total, sources: sources.length });
  await addMessage(ctx.boardId, "assistant", `Built "${plan.title}" from ${sources.length} live sources in ${secs(total)}.`);
  const followup = await followupP;
  if (followup) {
    await enqueue("poll", ctx.boardId, { reason: "followup", ...followup });
    await ctx.event("info", `Searching the web for ${followup.newsQueries.length + followup.webQueries.length} open questions next`);
  }
};
