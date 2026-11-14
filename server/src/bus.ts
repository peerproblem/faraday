import { EventEmitter } from "node:events";

export type BusMessage =
  | { type: "board"; boardId: string; version: number; status: string }
  | { type: "partial"; boardId: string; spec: unknown }
  | { type: "event"; boardId: string; event: { id: number; ts: number; kind: string; message: string; data: unknown } };

declare global {
  var __faradayBus: EventEmitter | undefined;
}

export function bus(): EventEmitter {
  if (!globalThis.__faradayBus) {
    globalThis.__faradayBus = new EventEmitter();
    globalThis.__faradayBus.setMaxListeners(500);
  }
  return globalThis.__faradayBus;
}

export function publish(msg: BusMessage) {
  bus().emit(`board:${msg.boardId}`, msg);
}

export function subscribe(boardId: string, fn: (msg: BusMessage) => void) {
  const key = `board:${boardId}`;
  bus().on(key, fn);
  return () => bus().off(key, fn);
}
