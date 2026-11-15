import { advanceSocialCursor } from "../../repo/social";
import type { RunCtx } from "../../graph/runner";
import {
  addSources,
  discardSources,
  getBoard,
  getSources,
  getSourceTexts,
  listSources,
  markExtracted,
  markPolled,
  refreshSources,
  setSourceLanguage,
  setSourceTriage,
  setStatus,
  type BoardRow,
  type FoundDoc,
} from "../../repo/boards";
import { applyMerge, listFacts, metricHistory, saveRejected, setQuoteTranslations } from "../../repo/facts";
import type {
  BoardData,
  BoardSpecV2,
  BoardStatus,
  BoardTier,
  ExtractedFact,
  Fact,
  FactDiff,
  Plan,
  Source,
  StagedFact,
} from "../../spec";
import { assemble, type HeaderOverrides } from "../assemble";
import { mergeFacts, type MergeOpts } from "../merge";
import { verifyFacts } from "../verify";
import { batches, extractBatch, pickExtractSources, type Focus } from "../nodes/extract";
import { EMPTY_HINTS, makeHints, needsHints } from "../nodes/hints";
import { pickReadTargets, readSources, type ReadStats } from "../nodes/read";
import { englishTitles, type SourceTitle } from "../nodes/titles";
import { pickQuotes, translateQuotes } from "../nodes/translate";
import { triage, untriaged, type TriageResult } from "../nodes/triage";
import { LIMITS } from "../nodes/util";

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadBoard(ctx: RunCtx): Promise<BoardRow> {
  const b = await getBoard(ctx.boardId);
  if (!b) throw new Error(`board ${ctx.boardId} not found`);
  return b;
}

export async function setBoardStatus(ctx: RunCtx, status: BoardStatus, tier: BoardTier) {
  await setStatus(ctx.boardId, status);
  ctx.emit({ type: "status", status, tier });
}

export async function recordBoardCheck(ctx: RunCtx) {
  const lastPolledAt = Date.now();
  await markPolled(ctx.boardId, lastPolledAt);
  ctx.emit({ type: "polled", lastPolledAt });
}

export async function ingest(ctx: RunCtx, docs: FoundDoc[]): Promise<Source[]> {
  const added = await addSources(ctx.boardId, docs);
  for (const doc of docs) {
    if (doc.kind === "social" && doc.socialCursor) {
      await advanceSocialCursor(ctx.boardId, doc.socialCursor.queryKey, doc.socialCursor.sinceId);
      break; // One combined X query per gather.
    }
  }
  if (added.length) ctx.emit({ type: "sources", added, discarded: [] });
  return added;
}

/** Re-opens known sources whose page a monitor saw change (docs with `refresh`). Emits them so clients replace them. */
export async function refreshRound(ctx: RunCtx, docs: FoundDoc[]): Promise<Source[]> {
  if (!docs.some((d) => d.refresh)) return [];
  const refreshed = await refreshSources(ctx.boardId, docs);
  if (refreshed.length) ctx.emit({ type: "sources", added: refreshed, discarded: [] });
  return refreshed;
}

/** Triage every untriaged source of the board. `round` keeps resumed runs apart. */
export async function triageRound(ctx: RunCtx, plan: Plan, round: string): Promise<TriageResult> {
  const targets = untriaged(await listSources(ctx.boardId));
  if (targets.length === 0) return { rows: [], kept: [], dropped: [], failed: [] };
  const res = await ctx.step(
    "triage",
    { round, ids: targets.map((s) => s.id) },
    async (_i, use, signal) => {
      const r = await triage(plan, targets, use, signal);
      await setSourceTriage(ctx.boardId, r.rows.map(({ id, relevance, sourceType }) => ({ id, relevance, sourceType })));
      await discardSources(ctx.boardId, r.dropped);
      return r;
    },
    { key: round, timeoutMs: 90_000, retries: 1 },
  );
  if (res.dropped.length) ctx.emit({ type: "sources", added: [], discarded: res.dropped });
  await languageRound(ctx, round, targets, res);
  return res;
}

/**
 * Records each triaged source's language. Kept non-English sources get an English display title (the board is
 * English only); clients get them again so they replace the original titles. Failure is not fatal: those sources are
 * still marked non-English, so the UI shows them by site name with no snippet.
 */
async function languageRound(ctx: RunCtx, round: string, targets: Source[], res: TriageResult): Promise<void> {
  const english = res.rows.filter((r) => r.english >= 0.5).map((r) => ({ id: r.id, lang: "en", titleEn: null }));
  const kept = new Set(res.kept);
  const foreignRows = res.rows.filter((r) => r.english < 0.5);
  const foreignKept = targets.filter((s) => kept.has(s.id) && foreignRows.some((r) => r.id === s.id));
  const foreignDropped = foreignRows.filter((r) => !kept.has(r.id)).map((r) => ({ id: r.id, lang: "und", titleEn: null }));
  let titles: SourceTitle[] = [];
  if (foreignKept.length) {
    titles = await ctx.step(
      "titles",
      { round, ids: foreignKept.map((s) => s.id) },
      async (_i, use, signal) => {
        try {
          return await englishTitles(foreignKept, use, signal);
        } catch (e) {
          if (signal.aborted) throw e;
          await ctx.event("error", `Could not write English titles for ${foreignKept.length} non-English sources: ${errText(e)}`);
          return foreignKept.map((s) => ({ id: s.id, lang: "und", titleEn: null }));
        }
      },
      { key: round, timeoutMs: 45_000, optional: true, fallback: foreignKept.map((s) => ({ id: s.id, lang: "und", titleEn: null })) },
    );
  }
  await setSourceLanguage(ctx.boardId, [...english, ...foreignDropped, ...withLanguageRows(foreignKept, titles)]);
  if (foreignKept.length) {
    const updated = await getSources(ctx.boardId, foreignKept.map((s) => s.id));
    if (updated.length) ctx.emit({ type: "sources", added: updated, discarded: [] });
  }
}

/**
 * Every kept non-English source needs a language row: one left without it (lang NULL) would be shown in its own
 * language, since only its script is checked then. Sources the titles step skipped are marked "und".
 */
export function withLanguageRows(foreignKept: Pick<Source, "id">[], titles: SourceTitle[]): SourceTitle[] {
  const have = new Set(titles.map((t) => t.id));
  return [...titles, ...foreignKept.filter((s) => !have.has(s.id)).map((s) => ({ id: s.id, lang: "und", titleEn: null }))];
}

/**
 * Reads full pages for the best official and web sources. Optional: failures fall back to snippets.
 * `fresh`: ids to fetch without cache (pages a monitor saw change); they are read first.
 */
export async function readRound(
  ctx: RunCtx,
  round: string,
  sources: Source[],
  max: number,
  fresh: string[] = [],
  country: string | null = null,
): Promise<string[]> {
  const freshIds = new Set(fresh);
  const targets = [
    ...pickReadTargets(sources.filter((s) => freshIds.has(s.id)), max),
    ...pickReadTargets(sources.filter((s) => !freshIds.has(s.id)), max),
  ].slice(0, Math.max(0, max));
  if (targets.length === 0) return [];
  let stats: ReadStats | null = null;
  const ids = await ctx.step(
    "read",
    { round, ids: targets.map((s) => s.id), fresh: targets.filter((s) => freshIds.has(s.id)).map((s) => s.id), country },
    (_i, use, signal) => readSources(ctx.boardId, targets, use, signal, freshIds, { country, onStats: (s) => (stats = s) }),
    { key: round, timeoutMs: 90_000, optional: true, fallback: [] },
  );
  const st = stats as ReadStats | null;
  if (st?.rescued) await ctx.event("stage", `Oxylabs read ${st.rescued} ${st.rescued === 1 ? "page" : "pages"} Context.dev could not`, st);
  return ids;
}

export type ExtractOutcome = { staged: StagedFact[]; rejected: { fact: ExtractedFact; reason: string }[]; sourceIds: string[] };

/**
 * Extracts and verifies in batches (concurrently). `onBatch` gets the facts staged so far after every batch,
 * for partial display. Batches that fail are skipped.
 */
export async function extractRound(
  ctx: RunCtx,
  plan: Plan,
  round: string,
  picked: Source[],
  opts: { focus?: Focus; onBatch?: (staged: StagedFact[]) => void; batchSize?: number } = {},
): Promise<ExtractOutcome> {
  if (picked.length === 0) return { staged: [], rejected: [], sourceIds: [] };
  const all = await listSources(ctx.boardId);
  const texts = await getSourceTexts(ctx.boardId, picked.map((s) => s.id));
  const staged: StagedFact[] = [];
  const rejected: ExtractOutcome["rejected"] = [];
  await ctx.map(batches(picked, opts.batchSize), LIMITS.extractConcurrency, async (batch, i) => {
    const facts = await ctx.step(
      "extract",
      { round, ids: batch.map((s) => s.id), focus: opts.focus ?? null },
      (_i, use, signal) => extractBatch(plan, batch, texts, use, signal, { focus: opts.focus }),
      { key: `${round}-b${i}`, timeoutMs: 75_000, retries: 1, optional: true, fallback: [] as ExtractedFact[] },
    );
    const v = verifyFacts({ facts, sources: all, texts });
    staged.push(...v.accepted);
    rejected.push(...v.rejected);
    opts.onBatch?.([...staged]);
  });
  // Keep the order stable across runs: by source id, then position.
  staged.sort((a, b) => Number(a.sourceId.slice(1)) - Number(b.sourceId.slice(1)));
  return { staged, rejected, sourceIds: picked.map((s) => s.id) };
}

/** Hints (optional model call) then a deterministic merge persisted in one step. */
export async function mergeRound(ctx: RunCtx, plan: Plan, round: string, out: ExtractOutcome): Promise<FactDiff> {
  const empty: FactDiff = { added: [], changed: [], superseded: 0 };
  if (out.staged.length === 0) {
    if (out.sourceIds.length) await markExtracted(ctx.boardId, out.sourceIds);
    if (out.rejected.length) await saveRejected(ctx.boardId, ctx.runId, out.rejected);
    return empty;
  }
  const current = await listFacts(ctx.boardId, { status: ["active"] });
  const hints = needsHints(current, out.staged)
    ? await ctx.step(
        "hints",
        { round, n: out.staged.length },
        (_i, use, signal) => makeHints(plan, current, out.staged, use, signal),
        { key: round, timeoutMs: 12_000, optional: true, fallback: EMPTY_HINTS },
      )
    : EMPTY_HINTS;
  const opts = mergeOpts(await listSources(ctx.boardId, { includeDiscarded: true }));
  const diff = await ctx.step(
    "merge",
    { round, n: out.staged.length, sources: out.sourceIds },
    async () => {
      // Re-read inside the step: a retry after applyMerge committed must see those rows, or it inserts them twice.
      const fresh = await listFacts(ctx.boardId, { status: ["active"] });
      const result = mergeFacts(fresh, out.staged, hints, opts);
      await applyMerge(ctx.boardId, ctx.runId, result);
      if (out.rejected.length) await saveRejected(ctx.boardId, ctx.runId, out.rejected);
      await markExtracted(ctx.boardId, out.sourceIds);
      return result.diff;
    },
    { key: round, timeoutMs: 30_000, retries: 2 },
  );
  await translateRound(ctx, round);
  return diff;
}

/**
 * Writes English translations for verified quotes from non-English sources (the board is English only, and the
 * quote is what people read behind a figure and in an on-the-ground report). One model call per round, the facts
 * just merged and older ones still waiting. Optional: without a translation a quote is simply not shown.
 */
export async function translateRound(ctx: RunCtx, round: string): Promise<number> {
  const [facts, sources] = await Promise.all([listFacts(ctx.boardId, { status: ["active"] }), listSources(ctx.boardId, { includeDiscarded: true })]);
  const targets = pickQuotes(facts, sources);
  if (!targets.length) return 0;
  return ctx.step(
    "translate",
    { round, ids: targets.map((t) => t.id) },
    async (_i, use, signal) => {
      const done = await translateQuotes(targets, use, signal);
      await setQuoteTranslations(ctx.boardId, done);
      return done.length;
    },
    { key: round, timeoutMs: 45_000, optional: true, fallback: 0 },
  );
}

export function mergeOpts(sources: Source[]): MergeOpts {
  return {
    sourceTypes: new Map(sources.map((s) => [s.id, s.kind === "social" ? "social" : s.sourceType])),
    relevance: new Map(sources.map((s) => [s.id, s.relevance])),
  };
}

/** Facts as they would be after merging `staged`, without writing. Used for partial display only. */
export function provisionalFacts(boardId: string, current: Fact[], staged: StagedFact[], now: number, opts: MergeOpts = {}): Fact[] {
  const r = mergeFacts(current, staged, EMPTY_HINTS, opts);
  const gone = new Set(r.supersede.map((s) => s.id));
  const extra = new Map(r.addSources.map((a) => [a.id, a.sourceIds]));
  const kept = current
    .filter((f) => !gone.has(f.id))
    .map((f) => (extra.has(f.id) ? { ...f, sourceIds: [...new Set([...f.sourceIds, ...extra.get(f.id)!])] } : f));
  const inserted: Fact[] = r.insert.map((row, i) => ({
    id: -(i + 1),
    boardId,
    kind: row.kind,
    key: row.key,
    payload: row.payload,
    valueNum: row.valueNum,
    asOf: row.asOf,
    sourceIds: row.sourceIds,
    quote: row.quote,
    verified: true,
    status: row.status ?? "active",
    supersededBy: null,
    runId: null,
    createdAt: now,
  }));
  return [...kept, ...inserted.filter((f) => f.status === "active")];
}

export async function composeData(
  ctx: RunCtx,
  plan: Plan,
  spec: BoardSpecV2,
  prev: BoardData | null,
  overrides: HeaderOverrides,
  facts?: Fact[],
): Promise<{ spec: BoardSpecV2; data: BoardData; facts: Fact[] }> {
  const [active, history, sources] = await Promise.all([
    facts ? Promise.resolve(facts) : listFacts(ctx.boardId, { status: ["active"] }),
    metricHistory(ctx.boardId),
    listSources(ctx.boardId, { includeDiscarded: true }),
  ]);
  const out = assemble({ plan, spec, facts: active, metricHistory: history, sources, prev, overrides, now: Date.now() });
  return { ...out, facts: active };
}

/** Sources picked for extraction: triaged, kept, not extracted yet. */
export async function extractable(ctx: RunCtx, hasFacts: Record<string, number>, cap = LIMITS.maxExtract(), only?: Set<string>): Promise<Source[]> {
  const sources = (await listSources(ctx.boardId)).filter((s) => s.relevance !== null && (!only || only.has(s.id)));
  return pickExtractSources(sources, cap, hasFacts);
}

export function officialUrls(sources: Source[], max = 4): string[] {
  return sources
    .filter((s) => s.sourceType === "official" && (s.relevance ?? 0) >= 0.6 && s.kind !== "monitor" && s.kind !== "social")
    .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
    .slice(0, max)
    .map((s) => s.url);
}

export const hasFactsMap = (rows: TriageResult["rows"], into: Record<string, number> = {}) => {
  for (const r of rows) into[r.id] = r.hasFacts;
  return into;
};
