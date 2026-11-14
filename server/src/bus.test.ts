import { afterEach, describe, expect, it, vi } from "vitest";
import { flushRemote, publish, setBusMode, subscribe, subscribeAll, subscriberCount } from "./bus";
import type { StreamMsg } from "./spec";

const status: StreamMsg = { type: "status", status: "live", tier: "hot" };

afterEach(() => {
  setBusMode("local");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("bus (local)", () => {
  it("delivers to the board's subscribers and to subscribeAll", () => {
    const got: StreamMsg[] = [];
    const all: string[] = [];
    const off = subscribe("b1", (m) => got.push(m));
    const offAll = subscribeAll((m) => all.push(m.boardId));
    publish("b1", status);
    publish("b2", status);
    expect(got).toEqual([status]);
    expect(all).toEqual(["b1", "b2"]);
    expect(subscriberCount("b1")).toBe(1);
    off();
    offAll();
    expect(subscriberCount("b1")).toBe(0);
  });

  it("coalesces partials to the latest one per 500ms and drops a pending partial when data arrives", () => {
    vi.useFakeTimers();
    const got: StreamMsg[] = [];
    const off = subscribe("b3", (m) => got.push(m));
    publish("b3", { type: "partial", stage: "one" });
    publish("b3", { type: "partial", stage: "two" });
    expect(got).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(got).toEqual([{ type: "partial", stage: "two" }]);

    publish("b3", { type: "partial", stage: "three" });
    publish("b3", { type: "data", version: 2, widgets: {} });
    vi.advanceTimersByTime(1_000);
    expect(got.map((m) => (m.type === "partial" ? m.stage : m.type))).toEqual(["two", "data"]);
    off();
  });
});

describe("bus (remote)", () => {
  it("posts messages in order to the api with the internal key and swallows failures", async () => {
    process.env.INTERNAL_API_KEY = "k1";
    process.env.ENGINE_PORT = "4999";
    const calls: { url: string; auth: string | null; body: unknown }[] = [];
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        n += 1;
        calls.push({ url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
        if (n === 1) throw new Error("connection refused");
        return new Response("{}");
      }),
    );
    setBusMode("remote");
    const local: StreamMsg[] = [];
    const off = subscribe("b4", (m) => local.push(m));
    publish("b4", status);
    publish("b4", { type: "hello", version: 1 });
    await flushRemote();
    expect(local).toEqual([]);
    expect(calls.map((c) => c.url)).toEqual(["http://127.0.0.1:4999/internal/publish", "http://127.0.0.1:4999/internal/publish"]);
    expect(calls[0].auth).toBe("Bearer k1");
    expect(calls.map((c) => (c.body as { msg: StreamMsg }).msg.type)).toEqual(["status", "hello"]);
    off();
  });
});
