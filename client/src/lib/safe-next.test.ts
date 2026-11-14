import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps paths on this site", () => {
    expect(safeNext("/me")).toBe("/me");
    expect(safeNext("/me/valencia-floods?x=1#top")).toBe("/me/valencia-floods?x=1#top");
  });

  it("refuses other sites and odd values", () => {
    for (const v of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "evil.com", "", "/a\\b", "/\tevil", undefined, ["/me"], 3]) {
      expect(safeNext(v)).toBe("/");
    }
  });
});
