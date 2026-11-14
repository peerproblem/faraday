import { describe, expect, it } from "vitest";
import { bearerOk, sign, verifySignature } from "./signature";

describe("verifySignature", () => {
  const body = JSON.stringify({ monitor_id: "m1" });
  const now = 1_800_000_000_000;

  it("accepts a fresh, correct signature", () => {
    expect(verifySignature(body, sign(body, "s3cret", now), "s3cret", now)).toBe(true);
  });
  it("rejects the wrong secret, a changed body, and a missing header", () => {
    const h = sign(body, "s3cret", now);
    expect(verifySignature(body, h, "other", now)).toBe(false);
    expect(verifySignature(body + " ", h, "s3cret", now)).toBe(false);
    expect(verifySignature(body, undefined, "s3cret", now)).toBe(false);
    expect(verifySignature(body, "t=1", "s3cret", now)).toBe(false);
  });
  it("rejects signatures older than five minutes", () => {
    const h = sign(body, "s3cret", now - 301_000);
    expect(verifySignature(body, h, "s3cret", now)).toBe(false);
  });
});

describe("bearerOk", () => {
  it("compares the key exactly", () => {
    expect(bearerOk("Bearer abc", "abc")).toBe(true);
    expect(bearerOk("Bearer abd", "abc")).toBe(false);
    expect(bearerOk("abc", "abc")).toBe(false);
    expect(bearerOk("Bearer abc", "")).toBe(false);
  });
});
