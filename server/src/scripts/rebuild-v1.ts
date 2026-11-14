// Queues a fresh v2 build for every board still on the v1 spec: npm run rebuild-v1
// A running worker picks the jobs up. The build writes spec_version 2 when it saves the board.
import { closePool } from "../db/pool";
import { hasPendingJob, enqueue } from "../repo/jobs";
import { addEvent, listV1BoardIds, setStatus } from "../repo/boards";

const ids = await listV1BoardIds();
if (ids.length === 0) console.log("no v1 boards");
for (const id of ids) {
  if (await hasPendingJob(id, ["build"])) {
    console.log(`${id}: build already queued`);
    continue;
  }
  await setStatus(id, "queued");
  await addEvent(id, "info", "Rebuilding this board with the new pipeline");
  const jobId = await enqueue("build", id, { rebuild: true }, { priority: 25 });
  console.log(`${id}: build job ${jobId}`);
}
await closePool();
