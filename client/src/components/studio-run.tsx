"use client";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Waterfall, type WaterfallSpan } from "@/components/ui/waterfall";
import type { RunView } from "@/lib/spec";

const NODE_LABEL: Record<string, string> = {
  plan: "Plan",
  gather: "Read the web",
  triage: "Triage sources",
  read: "Read official pages",
  extract: "Extract facts",
  verify: "Verify",
  merge: "Merge",
  hints: "Normalise keys",
  coverage: "Coverage check",
  narrative: "Write summary",
  assess: "Assess severity",
  geocode: "Place on map",
  assemble: "Assemble",
  watch: "Set up monitors",
  collect: "Collect updates",
  materiality: "Is it material?",
  route: "Route the edit",
  "plan-patch": "Edit the plan",
  save: "Save",
};

const statusTone: Record<string, BadgeVariant> = { done: "success", running: "accent", failed: "danger", skipped: "neutral" };

/** Bars are coloured by what happened to the step, from the chart palette: ink, blue, red, grey. */
const KINDS = { done: 2, running: 1, failed: 6, skipped: 8 };

export function nodeLabel(node: string) {
  return NODE_LABEL[node] ?? node.replace(/[-_]/g, " ");
}

/** Waterfall rows from run steps: start and duration relative to the run start. */
export function runRows(view: RunView, now = Date.now()) {
  if (!view.run) return [];
  const t0 = view.run.startedAt;
  return view.steps.map((s) => ({
    value: `${s.node}:${s.stepKey}`,
    label: s.stepKey && s.stepKey !== "-" && s.stepKey !== "" ? `${nodeLabel(s.node)} ${s.stepKey}` : nodeLabel(s.node),
    start: Math.max(0, s.startedAt - t0),
    duration: Math.max(1, s.ms ?? (s.status === "running" ? now - s.startedAt : 0)),
    step: s,
  }));
}

const secs = (ms: number | null) => (ms === null ? "…" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

export function RunWaterfall({ view }: { view: RunView | null }) {
  if (!view?.run) {
    return (
      <EmptyState title="No runs yet" description="The pipeline appears here once the first run starts." />
    );
  }
  const rows = runRows(view);
  const items: WaterfallSpan[] = rows.map((r) => ({
    value: r.value,
    label: r.step.attempt > 1 ? `${r.label} (try ${r.step.attempt})` : r.label,
    start: r.start,
    duration: r.duration,
    kind: r.step.status,
    detail: { Status: r.step.status, ...(r.step.error ? { Error: r.step.error } : {}) },
  }));
  const t = view.totals;
  const failed = view.steps.filter((s) => s.error && s.status === "failed");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge variant={statusTone[view.run.status] ?? "neutral"} pulse={view.run.status === "running"} mono>
          {view.run.graph} {view.run.status}
        </Badge>
        <Text as="div" size="sm" tone="muted" className="flex flex-wrap gap-x-3">
          <span>{secs(t.ms)}</span>
          <span>{t.llmCalls} model calls</span>
          <span>{t.contextCalls} Context.dev calls</span>
          <span>{(t.tokensIn + t.tokensOut).toLocaleString("en-US")} tokens</span>
        </Text>
      </div>
      {items.length ? (
        <Waterfall aria-label="Pipeline steps of the latest run" items={items} kinds={KINDS} nameHeader="Step" legend={false} />
      ) : (
        <Text size="sm" tone="muted">
          Starting…
        </Text>
      )}
      {failed.length ? (
        <ul className="grid gap-1">
          {failed.map((s) => (
            <li key={`${s.node}:${s.stepKey}`}>
              <Text size="sm" className="text-danger">
                {nodeLabel(s.node)}: {s.error}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
