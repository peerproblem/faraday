// Builds one board end to end without the HTTP layer: npm run smoke -- "<prompt>"
import { createBoard, getBoardView } from "./boards";
import { buildBoard } from "./harness/run";
import { subscribe } from "./bus";

const prompt = process.argv.slice(2).join(" ") || "Track the wildfires in Greece this week";
const { id } = await createBoard(prompt, null);
console.log("board", id);
subscribe(id, (m) => {
  if (m.type === "event") console.log(new Date(m.event.ts).toISOString().slice(11, 19), m.event.kind, m.event.message);
});
buildBoard(id);
const t0 = Date.now();
while (Date.now() - t0 < 240_000) {
  await new Promise((r) => setTimeout(r, 2000));
  const b = (await getBoardView(id))!;
  if (b.status === "live" || b.status === "error") {
    console.log(JSON.stringify({ status: b.status, metrics: b.metrics, sources: b.sources.length, spec: b.spec }, null, 2).slice(0, 6000));
    process.exit(0);
  }
}
process.exit(1);
