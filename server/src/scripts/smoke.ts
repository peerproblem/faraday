// Builds one board end to end in this process, without HTTP: npm run smoke -- "<prompt>"
// Needs DATABASE_URL, GEMINI_API_KEY and CONTEXT_DEV_API_KEY. Set FARADAY_MONITORS=off to skip monitors.
import { setBusMode, subscribe } from "../bus";
import { closePool } from "../db/pool";
import { runGraph } from "../graph/runner";
import { buildGraph } from "../pipeline/graphs";
import { createBoard, getBoardView } from "../repo/boards";
import { claim, complete, enqueue, fail } from "../repo/jobs";
import { latestRunView } from "../repo/runs";

const prompt = process.argv.slice(2).join(" ") || "Track the wildfires in Greece this week";
setBusMode("local");
const { id, slug } = await createBoard(prompt, null);
console.log(`board ${id} (${slug})`);
subscribe(id, (m) => {
  if (m.type === "event") console.log(new Date(m.event.ts).toISOString().slice(11, 19), m.event.kind.padEnd(6), m.event.message);
  else if (m.type === "status") console.log("status", m.status);
});

const jobId = await enqueue("build", id, {});
let job = null;
for (let i = 0; i < 20 && !job; i++) {
  job = await claim(`smoke-${process.pid}`, ["build"]);
  if (job && job.id !== jobId) {
    // Someone else's build job: leave it for a real worker.
    await fail(job.id, "claimed by smoke by mistake");
    job = null;
  }
  if (!job) await new Promise((r) => setTimeout(r, 500));
}
if (!job) throw new Error("could not claim the build job");

let code = 0;
try {
  await runGraph("build", job, buildGraph);
  await complete(job.id);
} catch (e) {
  code = 1;
  console.error("build failed:", e);
  await fail(job.id, (e as Error).message).catch(() => {});
}

const run = await latestRunView(id);
const board = await getBoardView(id);
console.log(
  JSON.stringify(
    {
      status: board?.status,
      version: board?.version,
      sources: board?.sources.length,
      widgets: board?.spec?.widgets.map((w) => `${w.id}:${w.type}`),
      hidden: board?.data?.hidden,
      headline: board?.data?.header.headline?.text,
      totals: run.totals,
      steps: run.steps.map((s) => `${s.node}${s.stepKey ? `[${s.stepKey}]` : ""} ${s.status} ${s.ms ?? "-"}ms`),
    },
    null,
    2,
  ),
);
await closePool();
process.exit(code);
