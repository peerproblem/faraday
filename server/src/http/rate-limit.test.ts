import { describe, expect, it } from "vitest";
import { createLimiter } from "./rate-limit";

describe("createLimiter", () => {
  it("allows up to max hits in the window, then refuses with a retry time", () => {
    const l = createLimiter({ windowMs: 60_000, max: 2 });
    expect(l.hit("a", 0).ok).toBe(true);
    expect(l.hit("a", 1_000).ok).toBe(true);
    const third = l.hit("a", 2_000);
    expect(third.ok).toBe(false);
    expect(third.retryAfterMs).toBe(58_000);
  });

  it("keeps keys apart and frees slots as the window slides", () => {
    const l = createLimiter({ windowMs: 1_000, max: 1 });
    expect(l.hit("a", 0).ok).toBe(true);
    expect(l.hit("b", 0).ok).toBe(true);
    expect(l.hit("a", 500).ok).toBe(false);
    expect(l.hit("a", 1_001).ok).toBe(true);
  });

  it("does not count refused hits", () => {
    const l = createLimiter({ windowMs: 1_000, max: 1 });
    l.hit("a", 0);
    l.hit("a", 100);
    l.hit("a", 200);
    expect(l.hit("a", 1_000).ok).toBe(true);
  });
});
