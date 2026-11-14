import { describe, expect, it } from "vitest";
import { etagMatches } from "./view-cache";

describe("etagMatches", () => {
  it("matches strong, weak and listed tags", () => {
    expect(etagMatches('"v3-live-hot"', '"v3-live-hot"')).toBe(true);
    expect(etagMatches('W/"v3-live-hot"', '"v3-live-hot"')).toBe(true);
    expect(etagMatches('"v2-live-hot", "v3-live-hot"', '"v3-live-hot"')).toBe(true);
    expect(etagMatches('"v2-live-hot"', '"v3-live-hot"')).toBe(false);
    expect(etagMatches(undefined, '"v3-live-hot"')).toBe(false);
  });
});
