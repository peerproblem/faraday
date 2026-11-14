// HTTP entry point: API, SSE and webhooks. Must not import pipeline/ or graph/.
import { serve } from "@hono/node-server";
import { setBusMode } from "./bus";
import { closePool } from "./db/pool";
import { createApp } from "./http/app";
import { log } from "./http/log";

const PORT = Number(process.env.ENGINE_PORT ?? 4000);
const HOST = process.env.ENGINE_HOST ?? "127.0.0.1";

setBusMode("local");
const app = createApp();

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  log("info", `api listening on http://${info.address}:${info.port}`);
});

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log("info", "api shutting down", { signal });
  // Open SSE streams never end on their own; give in-flight requests a few seconds.
  const force = setTimeout(() => process.exit(0), 5_000);
  force.unref();
  server.close(() => {
    void closePool().finally(() => process.exit(0));
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
