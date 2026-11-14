// Eval result shapes and the comparison against the v1 baseline.
// CLI: npx tsx src/eval/metrics.ts [results-file]   (default: newest server/.eval/results-*.json)
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.eval");

export type FixtureResult = {
  id: string;
  status: string;
  error: string | null;
  totalMs: number | null;
  firstSpecMs: number | null;
  firstDataMs: number | null;
  nodes: { node: string; count: number; ms: number; failed: number; skipped: number }[];
  llmCalls: number;
  tokensIn: number;
  tokensOut: number;
  contextCalls: number;
  sourcesKept: number;
  sourcesDiscarded: number;
  factsVerified: number;
  factsRejected: number;
  verificationPassRate: number | null;
  citationCoverage: number | null;
  questionCoverage: number | null;
  widgets: number;
  hiddenWidgets: number;
  monitorsRemoved: number;
};

export type ResultsFile = { pipeline: "v2"; createdAt: string; mode: "live" | "record" | "replay"; fixtures: FixtureResult[] };

type BaselineFixture = {
  id: string;
  status: string | null;
  totalMs: number | null;
  stages: Record<string, number>;
  llmCalls: number | null;
  contextCalls: number | null;
  sources: number;
  citedRatio: number | null;
  citationCoverage: number | null;
};
export type BaselineFile = { pipeline: "v1"; createdAt: string; fixtures: BaselineFixture[] };

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const s = (ms: number | null | undefined) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "-");
const pct = (x: number | null | undefined) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "-");
const change = (from: number | null, to: number | null) =>
  from && to !== null ? `${to <= from ? "-" : "+"}${Math.abs(Math.round(((to - from) / from) * 100))}%` : "-";

export function loadBaseline(): BaselineFile | null {
  try {
    return JSON.parse(readFileSync(path.join(EVAL_DIR, "baseline.json"), "utf8")) as BaselineFile;
  } catch {
    return null;
  }
}

export function latestResultsFile(): string | null {
  try {
    const files = readdirSync(EVAL_DIR).filter((f) => /^results-.*\.json$/.test(f)).sort();
    return files.length ? path.join(EVAL_DIR, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

/** v1 has no streamed partial with content, so its first content is the finished board. */
export function compare(results: ResultsFile, baseline: BaselineFile | null): string {
  const lines: string[] = [];
  const row = (cells: string[]) => lines.push(`| ${cells.join(" | ")} |`);
  row(["fixture", "status", "total v1", "total v2", "change", "first data v2", "llm v1", "llm v2", "ctx v1", "ctx v2", "sources v1", "kept v2", "verified", "cite cov v1", "cite cov v2", "questions"]);
  row(Array(16).fill("-"));
  for (const r of results.fixtures) {
    const b = baseline?.fixtures.find((x) => x.id === r.id);
    row([
      r.id,
      r.status,
      s(b?.totalMs),
      s(r.totalMs),
      change(b?.totalMs ?? null, r.totalMs),
      s(r.firstDataMs),
      String(b?.llmCalls ?? "-"),
      String(r.llmCalls),
      String(b?.contextCalls ?? "-"),
      String(r.contextCalls),
      String(b?.sources ?? "-"),
      String(r.sourcesKept),
      pct(r.verificationPassRate),
      pct(b?.citationCoverage),
      pct(r.citationCoverage),
      pct(r.questionCoverage),
    ]);
  }
  const ok = results.fixtures.filter((r) => r.status === "live");
  const bOk = baseline?.fixtures.filter((x) => x.status === "live" && ok.some((r) => r.id === x.id)) ?? [];
  const bTotal = avg(bOk.map((x) => x.totalMs));
  const vTotal = avg(ok.filter((r) => bOk.some((x) => x.id === r.id)).map((r) => r.totalMs));
  const vFirst = avg(ok.filter((r) => bOk.some((x) => x.id === r.id)).map((r) => r.firstDataMs));
  lines.push("");
  lines.push(`fixtures live: ${ok.length}/${results.fixtures.length}`);
  if (bTotal !== null && vTotal !== null) {
    const totalCut = 1 - vTotal / bTotal;
    lines.push(`avg total: v1 ${s(bTotal)} -> v2 ${s(vTotal)} (${Math.round(totalCut * 100)}% faster, target 30%: ${totalCut >= 0.3 ? "met" : "not met"})`);
  }
  if (bTotal !== null && vFirst !== null) {
    const firstCut = 1 - vFirst / bTotal;
    lines.push(`avg first content: v1 ${s(bTotal)} -> v2 ${s(vFirst)} (${Math.round(firstCut * 100)}% faster, target 50%: ${firstCut >= 0.5 ? "met" : "not met"})`);
  }
  lines.push(`avg verification pass rate: ${pct(avg(ok.map((r) => r.verificationPassRate)))}`);
  lines.push(`avg citation coverage: ${pct(avg(ok.map((r) => r.citationCoverage)))} (must be 100%)`);
  lines.push(`avg question coverage: ${pct(avg(ok.map((r) => r.questionCoverage)))}`);
  const slow = new Map<string, number[]>();
  for (const r of ok) for (const n of r.nodes) slow.set(n.node, [...(slow.get(n.node) ?? []), n.ms]);
  const top = [...slow.entries()].map(([node, ms]) => [node, avg(ms) ?? 0] as const).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) lines.push(`slowest nodes (avg summed ms per board): ${top.map(([n, ms]) => `${n} ${s(ms)}`).join(", ")}`);
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? latestResultsFile();
  if (!file) {
    console.error("no results file in server/.eval; run `npm run eval` first");
    process.exit(1);
  }
  console.log(compare(JSON.parse(readFileSync(file, "utf8")) as ResultsFile, loadBaseline()));
}
