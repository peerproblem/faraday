import type { GraphFn } from "../../graph/runner";
import { decide } from "../../llm/decide";
import { THRESHOLDS } from "../../llm/thresholds";
import { addMessage, listMessages, listSources, saveBoardVersion, savePlan } from "../../repo/boards";
import { listFacts } from "../../repo/facts";
import { specFromPlan, type HeaderOverrides } from "../assemble";
import { assess, type Assessment } from "../nodes/assess";
import { gather } from "../nodes/gather";
import { writeNarrative, type Narrative } from "../nodes/narrative";
import { applyPlanPatch, makePlanPatch } from "../nodes/plan";
import { LIMITS } from "../nodes/util";
import { composeData, extractable, extractRound, hasFactsMap, ingest, loadBoard, mergeRound, readRound, setBoardStatus, triageRound } from "./common";

type Scope = "layout" | "data" | "narrative" | "all";

export const editGraph: GraphFn = async (ctx) => {
  const instruction = String((ctx.job.payload as { instruction?: unknown } | null)?.instruction ?? "").trim();
  if (!instruction) throw new Error("edit job has no instruction");
  const board = await loadBoard(ctx);
  if (!board.plan || !board.spec) throw new Error("board is not built yet");
  const tier = board.tier;

  // The api may already have stored the instruction; store it once.
  await ctx.step(
    "instruction",
    { instruction },
    async () => {
      const users = (await listMessages(ctx.boardId)).filter((m) => m.role === "user");
      if (users[users.length - 1]?.content !== instruction) await addMessage(ctx.boardId, "user", instruction);
      return true;
    },
    { timeoutMs: 10_000 },
  );

  await setBoardStatus(ctx, "planning", tier);
  await ctx.event("edit", `Editing the program: ${instruction}`);
  const route = await ctx.step(
    "route",
    { instruction },
    async (i, use, signal) => {
      const r = await decide(
        { instruction: i.instruction, board: { title: board.plan!.title, widgets: board.spec!.widgets.map((w) => `${w.type}: ${w.title}`), metrics: board.plan!.metrics.map((m) => m.label) } },
        {
          needsNewData: { type: "boolean" as const, instructions: "Does doing this need information the board has not searched for yet?" },
          scope: {
            type: "choice" as const,
            instructions: "What does the instruction change?",
            criteria: {
              layout: "Only which widgets show or how they are arranged",
              data: "Track new figures, lists or statuses",
              narrative: "Only how the summary is written or what it focuses on",
              all: "Several of these, or the focus of the whole board",
            },
          },
        },
        { signal },
      );
      use.llm(r.model, { inputTokens: r.tokensIn, outputTokens: 0 });
      return { needsNewData: r.answers.needsNewData.probability >= THRESHOLDS.needsNewData, scope: r.answers.scope.choice as Scope };
    },
    { timeoutMs: 20_000, optional: true, fallback: { needsNewData: true, scope: "all" as Scope } },
  );

  const patch = await ctx.step("patch", { instruction }, (i, use, signal) => makePlanPatch(board.plan!, i.instruction, use, signal), { timeoutMs: 60_000, retries: 1 });
  const { plan, newKeys } = applyPlanPatch(board.plan, patch);
  await savePlan(ctx.boardId, plan);
  const spec = specFromPlan(plan);
  ctx.emit({ type: "partial", stage: "plan", spec });

  const hasFacts: Record<string, number> = {};
  // New tracked keys: re-read the best existing sources for just those keys.
  const focus = { metrics: newKeys.metrics, tables: newKeys.tables, statusGroups: newKeys.statusGroups };
  if (focus.metrics.length + focus.tables.length + focus.statusGroups.length > 0) {
    await setBoardStatus(ctx, "composing", tier);
    const top = (await listSources(ctx.boardId))
      .filter((s) => s.relevance !== null)
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
      .slice(0, 20);
    const out = await extractRound(ctx, plan, "focus", top, { focus });
    // Focused re-extraction must not mark sources as fully extracted for the rest of the plan.
    await mergeRound(ctx, plan, "focus", { ...out, sourceIds: [] });
    await ctx.event("stage", `Looked for the new figures in ${top.length} sources: ${out.staged.length} facts`);
  }

  const queries = { newsQueries: patch.newsQueries.slice(0, 3), webQueries: patch.webQueries.slice(0, 3) };
  if (route.needsNewData && queries.newsQueries.length + queries.webQueries.length > 0) {
    await setBoardStatus(ctx, "gathering", tier);
    const g = await ctx.step("gather", queries, (i, use, signal) => gather({ ...i, lookbackDays: plan.lookbackDays }, use, signal), { timeoutMs: 75_000, retries: 1 });
    const added = await ingest(ctx, g.docs);
    const tr = await triageRound(ctx, plan, "e1");
    hasFactsMap(tr.rows, hasFacts);
    const kept = (await listSources(ctx.boardId)).filter((s) => s.relevance !== null);
    await readRound(ctx, "e1", kept, 3);
    const picked = await extractable(ctx, hasFacts, 15, new Set(added.map((s) => s.id)));
    const out = await extractRound(ctx, plan, "e1", picked);
    await mergeRound(ctx, plan, "e1", out);
    await ctx.event("stage", `Read ${added.length} new sources for the edit`);
  }

  await setBoardStatus(ctx, "composing", tier);
  const facts = await listFacts(ctx.boardId, { status: ["active"] });
  const rewrite = route.scope === "narrative" || route.scope === "all" || newKeys.metrics.length > 0;
  const [narrative, assessment] = await Promise.all([
    rewrite
      ? ctx.step("narrative", { n: facts.length, instruction }, (_i, use, signal) => writeNarrative(plan, facts, use, signal), {
          timeoutMs: 60_000,
          optional: true,
          fallback: null as Narrative | null,
        })
      : Promise.resolve(null),
    route.scope === "all"
      ? ctx.step("assess", { n: facts.length }, (_i, use, signal) => assess(plan, facts, use, signal), { timeoutMs: 20_000, optional: true, fallback: null as Assessment | null })
      : Promise.resolve(null),
  ]);
  const overrides: HeaderOverrides = {
    ...(narrative ? { headline: narrative.headline, narrative: narrative.sentences } : {}),
    ...(assessment ? { assessment } : {}),
  };
  const { spec: finalSpec, data } = await composeData(ctx, plan, spec, board.data, overrides, facts);
  const version = await saveBoardVersion(ctx.boardId, { spec: finalSpec, data, changeNote: patch.reply, status: "live" });
  ctx.emit({ type: "spec", version, spec: finalSpec });
  ctx.emit({ type: "data", version, header: data.header, widgets: data.widgets, hidden: data.hidden });
  ctx.emit({ type: "status", status: "live", tier });
  await addMessage(ctx.boardId, "assistant", patch.reply);
  await ctx.event("edit", patch.reply, { scope: route.scope, newKeys });
};

export const EDIT_LIMITS = { focusSources: 20, maxExtract: () => LIMITS.maxExtract() };
