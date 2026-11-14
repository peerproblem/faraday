// Eval harness for the v2 pipeline (guide P0-5). Each fixture runs in its own child process with its own
// database faraday_test_eval_<n> (the DB pool is per process), through the real job queue and graph runner.
//
//   npm run eval                          all fixtures, live web, concurrency 2
//   npm run eval -- --only flood          one fixture
//   npm run eval -- --concurrency 4
//   npm run eval -- --record              live, and write Context.dev cassettes (server/.eval/cassettes)
//   npm run eval -- --replay              Context.dev from cassettes only (LLM calls stay live)
//   npm run eval -- --keep                keep the test databases for inspection
//
// Needs TEST_DATABASE_URL (the Aiven MySQL service, see README). Writes server/.eval/results-<ts>.json and prints
// the comparison against server/.eval/baseline.json.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mariadb from "mariadb";
import { connectionConfig } from "../db/connect";
import { fixtures, type Fixture } from "./fixtures";
import { compare, EVAL_DIR, loadBaseline, type FixtureResult, type ResultsFile } from "./metrics";

const SELF = fileURLToPath(import.meta.url);
const SERVER_DIR = path.resolve(path.dirname(SELF), "../..");
const RESULT_PREFIX = "EVAL_RESULT ";
const CHILD_TIMEOUT_MS = Number(process.env.EVAL_FIXTURE_TIMEOUT_MS ?? 420_000);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function testDbUrl(dbName: string) {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is not set (see .hov/v2-fan-plan.md)");
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  return { base: new URL(base), url: u.toString() };
}

async function adminQuery(sql: string) {
  const { base } = testDbUrl("x");
  const c = await mariadb.createConnection(connectionConfig(base.toString(), { database: null }));
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------- child: one fixture

async function runChild(fixtureId: string, dbName: string): Promise<FixtureResult> {
  const fixture = fixtures.find((f) => f.id === fixtureId);
  if (!fixture) throw new Error(`unknown fixture ${fixtureId}`);
  await adminQuery(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await adminQuery(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  process.env.DATABASE_URL = testDbUrl(dbName).url;
  delete process.env.FARADAY_SKIP_MIGRATE;

  // Imported after DATABASE_URL is set; the pool migrates the fresh database on first use.
  const { pool, all, closePool } = await import("../db/pool");
  const { setBusMode, subscribe } = await import("../bus");
  const boards = await import("../repo/boards");
  const jobs = await import("../repo/jobs");
  const { latestRunView } = await import("../repo/runs");
  const { runGraph } = await import("../graph/runner");
  const { buildGraph } = await import("../pipeline/graphs");
  const { removeBoardMonitors } = await import("../monitors");

  await pool();
  setBusMode("local");
  const { id: boardId } = await boards.createBoard(fixture.prompt, null);

  const t0 = Date.now();
  let firstSpecMs: number | null = null;
  let firstDataMs: number | null = null;
  const off = subscribe(boardId, (msg) => {
    const dt = Date.now() - t0;
    if (msg.type === "spec" || (msg.type === "partial" && msg.spec)) firstSpecMs ??= dt;
    const widgets = msg.type === "data" || msg.type === "partial" ? msg.widgets : undefined;
    if (widgets && Object.keys(widgets).length > 0) firstDataMs ??= dt;
  });

  let status = "error";
  let error: string | null = null;
  let monitorsRemoved = 0;
  try {
    await jobs.enqueue("build", boardId, {});
    const job = await jobs.claim(`eval-${process.pid}`, ["build"]);
    if (!job) throw new Error("could not claim the build job");
    try {
      await runGraph("build", job, buildGraph);
      await jobs.complete(job.id);
    } catch (e) {
      await jobs.fail(job.id, (e as Error).message).catch(() => {});
      throw e;
    }
    status = (await boards.getBoard(boardId))?.status ?? "missing";
  } catch (e) {
    error = (e as Error).message ?? String(e);
    status = "crash";
  } finally {
    off();
    monitorsRemoved = await removeBoardMonitors(boardId).catch(() => 0);
  }
  const totalMs = Date.now() - t0;

  const view = await latestRunView(boardId);
  const byNode = new Map<string, FixtureResult["nodes"][number]>();
  for (const st of view.steps) {
    const n = byNode.get(st.node) ?? { node: st.node, count: 0, ms: 0, failed: 0, skipped: 0 };
    n.count += 1;
    n.ms += st.ms ?? 0;
    if (st.status === "failed") n.failed += 1;
    if (st.status === "skipped") n.skipped += 1;
    byNode.set(st.node, n);
  }

  const kept = await boards.listSources(boardId);
  const everything = await boards.listSources(boardId, { includeDiscarded: true });

  const factRows = await all<{ status: string; verified: number; n: number }>(
    `SELECT status, verified, COUNT(*) AS n FROM facts WHERE board_id = ? GROUP BY status, verified`,
    [boardId],
  );
  const factsRejected = factRows.filter((r) => r.status === "rejected").reduce((a, r) => a + Number(r.n), 0);
  const factsVerified = factRows.filter((r) => r.status !== "rejected" && Number(r.verified) === 1).reduce((a, r) => a + Number(r.n), 0);
  const factsTotal = factsVerified + factsRejected;

  const board = await boards.getBoard(boardId);
  let citationCoverage: number | null = null;
  let widgets = 0;
  let hiddenWidgets = 0;
  if (board?.spec && board.data) {
    widgets = board.spec.widgets.length;
    hiddenWidgets = board.data.hidden.length;
    const items: { sources: string[] }[] = [];
    for (const w of board.spec.widgets) {
      const d = board.data.widgets[w.id] as { items?: { sources?: string[] }[] } | undefined;
      if ((w.type === "stat-grid" || w.type === "timeline") && d?.items) items.push(...d.items.map((x) => ({ sources: x.sources ?? [] })));
    }
    citationCoverage = items.length ? items.filter((x) => x.sources.length > 0).length / items.length : null;
  }

  // The last coverage step holds { answered: { [questionId]: P(answered) }, unanswered }.
  let questionCoverage: number | null = null;
  const cov = await all<{ output: string | null }>(
    `SELECT s.output FROM run_steps s JOIN runs r ON r.id = s.run_id
     WHERE r.board_id = ? AND s.node LIKE 'coverage%' AND s.status = 'done' AND s.output IS NOT NULL ORDER BY s.id DESC LIMIT 1`,
    [boardId],
  );
  if (cov[0]?.output) {
    try {
      const out = JSON.parse(cov[0].output) as { answered?: Record<string, number> };
      const ps = Object.values(out.answered ?? {});
      const { THRESHOLDS } = await import("../llm/thresholds");
      if (ps.length) questionCoverage = ps.filter((p) => p >= THRESHOLDS.answered).length / ps.length;
    } catch {}
  }

  if (!error && board?.status === "error") {
    const errs = await boards.listEvents(boardId, { limit: 50 });
    error = errs.find((e) => e.kind === "error")?.message ?? "board ended in error";
  }

  await closePool();
  return {
    id: fixture.id,
    status,
    error,
    totalMs,
    firstSpecMs,
    firstDataMs,
    nodes: [...byNode.values()].sort((a, b) => b.ms - a.ms),
    llmCalls: view.totals.llmCalls,
    tokensIn: view.totals.tokensIn,
    tokensOut: view.totals.tokensOut,
    contextCalls: view.totals.contextCalls,
    sourcesKept: kept.length,
    sourcesDiscarded: everything.length - kept.length,
    factsVerified,
    factsRejected,
    verificationPassRate: factsTotal ? factsVerified / factsTotal : null,
    citationCoverage,
    questionCoverage,
    widgets,
    hiddenWidgets,
    monitorsRemoved,
  };
}

// ---------------------------------------------------------------- parent: orchestrate

function crashed(f: Fixture, error: string): FixtureResult {
  return {
    id: f.id,
    status: "crash",
    error,
    totalMs: null,
    firstSpecMs: null,
    firstDataMs: null,
    nodes: [],
    llmCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    contextCalls: 0,
    sourcesKept: 0,
    sourcesDiscarded: 0,
    factsVerified: 0,
    factsRejected: 0,
    verificationPassRate: null,
    citationCoverage: null,
    questionCoverage: null,
    widgets: 0,
    hiddenWidgets: 0,
    monitorsRemoved: 0,
  };
}

function spawnChild(f: Fixture, dbName: string, env: NodeJS.ProcessEnv): Promise<FixtureResult> {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn(process.execPath, [...process.execArgv, SELF, "--child", f.id, dbName], { cwd: SERVER_DIR, env });
    const kill = setTimeout(() => p.kill("SIGKILL"), CHILD_TIMEOUT_MS);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => {
      clearTimeout(kill);
      const line = out.split("\n").find((l) => l.startsWith(RESULT_PREFIX));
      if (line) resolve(JSON.parse(line.slice(RESULT_PREFIX.length)) as FixtureResult);
      else resolve(crashed(f, `child exited ${code}: ${out.slice(-800)}`));
    });
  });
}

async function runParent() {
  const only = arg("only");
  const concurrency = Math.max(1, Number(arg("concurrency") ?? 2));
  const mode: ResultsFile["mode"] = flag("replay") ? "replay" : flag("record") ? "record" : "live";
  const keep = flag("keep");
  const selected = only ? fixtures.filter((f) => only.split(",").includes(f.id)) : fixtures;
  if (!selected.length) throw new Error(`no fixture matches --only ${only}`);

  const env: NodeJS.ProcessEnv = { ...process.env, FARADAY_WORKER: "off" };
  delete env.EVAL_RECORD;
  delete env.EVAL_REPLAY;
  if (mode === "record") env.EVAL_RECORD = "1";
  if (mode === "replay") env.EVAL_REPLAY = "1";

  const results: FixtureResult[] = [];
  const queue = selected.map((f) => ({ f, n: fixtures.indexOf(f) + 1 }));
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const { f, n } = queue.shift()!;
        const dbName = `faraday_test_eval_${n}`;
        const r = await spawnChild(f, dbName, env);
        console.log(`${f.id}: ${r.status} ${r.totalMs === null ? "-" : `${(r.totalMs / 1000).toFixed(1)}s`}${r.error ? ` (${r.error.slice(0, 160)})` : ""}`);
        results.push(r);
        if (!keep) await adminQuery(`DROP DATABASE IF EXISTS \`${dbName}\``).catch(() => {});
      }
    }),
  );
  results.sort((a, b) => fixtures.findIndex((f) => f.id === a.id) - fixtures.findIndex((f) => f.id === b.id));

  const file: ResultsFile = { pipeline: "v2", createdAt: new Date().toISOString(), mode, fixtures: results };
  mkdirSync(EVAL_DIR, { recursive: true });
  const out = path.join(EVAL_DIR, `results-${file.createdAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify(file, null, 2));
  console.log(`\nwrote ${path.relative(SERVER_DIR, out)}\n`);
  console.log(compare(file, loadBaseline()));
  process.exit(results.every((r) => r.status === "live") ? 0 : 1);
}

if (process.argv.includes("--child")) {
  const i = process.argv.indexOf("--child");
  runChild(process.argv[i + 1], process.argv[i + 2])
    .then((r) => {
      console.log(RESULT_PREFIX + JSON.stringify(r));
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
} else {
  runParent().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
