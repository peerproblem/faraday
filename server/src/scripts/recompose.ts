// Translates pending quotes and recomposes boards from their stored facts, with no search: npm run recompose -- <boardId...>
// Without ids it covers every live shared topic. For data a release adds to boards (such as the verified sentence
// behind each figure), which a board otherwise only gets the next time a poll finds something new.
import type { Usage } from "../graph/runner";
import { closePool } from "../db/pool";
import { all } from "../db/pool";
import { getBoard, listSources, saveBoardVersion } from "../repo/boards";
import { listFacts, metricHistory, setQuoteTranslations } from "../repo/facts";
import { assemble, diffData } from "../pipeline/assemble";
import { pickQuotes, translateQuotes } from "../pipeline/nodes/translate";

const use: Usage = { llm: () => {}, context: () => {} };

async function recompose(id: string): Promise<void> {
  const board = await getBoard(id);
  if (!board?.plan || !board.spec || !board.data) return console.log(`${id}: no built board, skipped`);
  const sources = await listSources(id, { includeDiscarded: true });
  // In rounds of MAX_QUOTES. A quote whose translation was dropped stays pending, so stop when a round adds none.
  const tried = new Set<number>();
  for (let round = 0; round < 10; round++) {
    const pending = pickQuotes(await listFacts(id, { status: ["active"] }), sources, 500).filter((q) => !tried.has(q.id)).slice(0, 40);
    if (!pending.length) break;
    for (const q of pending) tried.add(q.id);
    const done = await translateQuotes(pending, use, AbortSignal.timeout(60_000));
    await setQuoteTranslations(id, done);
    console.log(`${id}: translated ${done.length} of ${pending.length} quotes`);
  }
  const [facts, history] = await Promise.all([listFacts(id, { status: ["active"] }), metricHistory(id)]);
  const out = assemble({ plan: board.plan, spec: board.spec, facts, metricHistory: history, sources, prev: board.data, overrides: {}, now: Date.now() });
  const changed = diffData(board.data, out.data);
  if (!changed.widgets.length && !changed.header && !changed.hidden) return console.log(`${id}: unchanged`);
  const version = await saveBoardVersion(id, { spec: out.spec, data: out.data, changeNote: null });
  console.log(`${id}: saved version ${version} (${changed.widgets.length} widgets changed)`);
}

const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : (await all<{ id: string }>(`SELECT id FROM boards WHERE deleted_at IS NULL AND origin = 'system' AND topic_state = 'active' AND status = 'live'`)).map((r) => r.id);
for (const id of ids) {
  try {
    await recompose(id);
  } catch (e) {
    console.error(`${id}: ${(e as Error).message}`);
  }
}
await closePool();
