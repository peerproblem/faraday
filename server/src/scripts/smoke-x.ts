// Explicitly invoked diagnostic: a single 10-post request, never retried (including later reruns).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cassetteDir, cassetteKey } from "../contextdev";
import { searchX, xQuery } from "../social/x";

if (!process.env.X_API_BEARER_TOKEN) throw new Error("X_API_BEARER_TOKEN is not set");
process.env.EVAL_RECORD = "1";
delete process.env.EVAL_REPLAY;
const query = xQuery(["earthquake lang:en"])!;
const dir = cassetteDir();
await mkdir(dir, { recursive: true });
const marker = path.join(dir, "x-smoke-attempt.json");
await writeFile(marker, JSON.stringify({ attemptedAt: new Date().toISOString(), query, maxResults: 10 }), { flag: "wx", mode: 0o600 });
try {
  const docs = await searchX(query);
  const file = path.join(dir, `${cassetteKey("x.search.recent", [query, null, 10])}.json`);
  const tape = JSON.parse(await readFile(file, "utf8")) as { result: Record<string, unknown> };
  const summary = { ok: true, requests: 1, maxResults: 10, documents: docs.length, responseKeys: Object.keys(tape.result), cassette: file };
  await writeFile(marker, JSON.stringify(summary), { mode: 0o600 });
  console.log(JSON.stringify(summary));
} catch (error) {
  const summary = { ok: false, requests: 1, error: error instanceof Error ? error.message : "X smoke failed" };
  await writeFile(marker, JSON.stringify(summary), { mode: 0o600 });
  console.error(JSON.stringify(summary));
  process.exitCode = 1;
}
