import { getRow, liveBoardIds } from "./boards";
import { pollBoard } from "./harness/run";

const POLL_EVERY_MS = Number(process.env.POLL_EVERY_MS ?? 3 * 60_000);

let timer: NodeJS.Timeout | undefined;
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const id of await liveBoardIds()) {
      const row = await getRow(id);
      if (!row) continue;
      if (row.last_polled_at && Date.now() - row.last_polled_at < POLL_EVERY_MS) continue;
      try {
        await pollBoard(id);
      } catch (e) {
        console.error("poll failed", id, e);
      }
    }
  } catch (e) {
    console.error("worker tick failed", e);
  } finally {
    ticking = false;
  }
}

export function startWorker() {
  if (timer || process.env.FARADAY_WORKER === "off") return;
  timer = setInterval(() => void tick(), 30_000);
  console.log(`[faraday] worker polling live boards every ${POLL_EVERY_MS / 1000}s`);
}
