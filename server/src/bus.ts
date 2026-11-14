// In the api process messages go to a local EventEmitter. In the worker process publish() POSTs them to
// http://127.0.0.1:<ENGINE_PORT>/internal/publish (Bearer INTERNAL_API_KEY); failures are swallowed.
// Partial messages are coalesced to at most 2 per second per board.
import { EventEmitter } from "node:events";
import type { StreamMsg } from "./spec";

export type BusMessage = { boardId: string; msg: StreamMsg };

const PARTIAL_EVERY_MS = 500;
const REMOTE_TIMEOUT_MS = 2_000;
const ANY = "*";

declare global {
  var __faradayBus: { emitter: EventEmitter; mode: "local" | "remote" } | undefined;
}

function state() {
  if (!globalThis.__faradayBus) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    globalThis.__faradayBus = { emitter, mode: "local" };
  }
  return globalThis.__faradayBus;
}

const pendingPartials = new Map<string, { msg: StreamMsg; timer: NodeJS.Timeout }>();
let remoteChain: Promise<void> = Promise.resolve();

export function setBusMode(mode: "local" | "remote"): void {
  state().mode = mode;
}

export function busMode() {
  return state().mode;
}

function deliver(boardId: string, msg: StreamMsg) {
  const s = state();
  if (s.mode === "local") {
    s.emitter.emit(`board:${boardId}`, msg);
    s.emitter.emit(ANY, { boardId, msg } satisfies BusMessage);
    return;
  }
  const body = JSON.stringify({ boardId, msg } satisfies BusMessage);
  // One request at a time keeps the order the worker published in.
  remoteChain = remoteChain.then(() => sendRemote(body)).catch(() => {});
}

async function sendRemote(body: string) {
  const port = process.env.ENGINE_PORT ?? "4000";
  try {
    await fetch(`http://127.0.0.1:${port}/internal/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.INTERNAL_API_KEY ?? ""}` },
      body,
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
  } catch {
    // Viewers miss this message only; everything that matters is already stored.
  }
}

export function publish(boardId: string, msg: StreamMsg): void {
  if (msg.type === "partial") {
    const pending = pendingPartials.get(boardId);
    if (pending) {
      pending.msg = msg;
      return;
    }
    const timer = setTimeout(() => {
      const p = pendingPartials.get(boardId);
      pendingPartials.delete(boardId);
      if (p) deliver(boardId, p.msg);
    }, PARTIAL_EVERY_MS);
    timer.unref?.();
    pendingPartials.set(boardId, { msg, timer });
    return;
  }
  // A partial that arrives after the stored result would show stale content.
  if (msg.type === "data" || msg.type === "spec" || msg.type === "status") {
    const pending = pendingPartials.get(boardId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingPartials.delete(boardId);
    }
  }
  deliver(boardId, msg);
}

export function subscribe(boardId: string, fn: (msg: StreamMsg) => void): () => void {
  const key = `board:${boardId}`;
  const e = state().emitter;
  e.on(key, fn);
  return () => e.off(key, fn);
}

/** Every message for every board, in the api process. */
export function subscribeAll(fn: (m: BusMessage) => void): () => void {
  const e = state().emitter;
  e.on(ANY, fn);
  return () => e.off(ANY, fn);
}

export function subscriberCount(boardId: string): number {
  return state().emitter.listenerCount(`board:${boardId}`);
}

/** Resolves when queued remote sends have finished. For shutdown and tests. */
export function flushRemote(): Promise<void> {
  return remoteChain;
}
