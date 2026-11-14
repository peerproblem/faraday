import { describe, expect, it } from "vitest";
import { useTestDb } from "../test/db";
import { getCachedGeocode, putCachedGeocode } from "./geocode";

const db = useTestDb("repo_geocode");

describe.skipIf(!db.enabled)("repo/geocode", () => {
  it("returns undefined when not cached", async () => {
    expect(await getCachedGeocode("Nowhere at all")).toBeUndefined();
  });

  it("stores and normalises hits", async () => {
    await putCachedGeocode("Valencia,  Spain", { lat: 39.47, lon: -0.38, displayName: "València, Spain" });
    expect(await getCachedGeocode("  valencia, spain ")).toEqual({ lat: 39.47, lon: -0.38, displayName: "València, Spain", countryCode: null });
  });

  it("stores the country code", async () => {
    await putCachedGeocode("Kyiv", { lat: 50.45, lon: 30.52, displayName: "Kyiv, Ukraine", countryCode: "UA" });
    expect((await getCachedGeocode("kyiv"))?.countryCode).toBe("UA");
  });

  it("caches misses for 7 days only", async () => {
    const t0 = 1_700_000_000_000;
    await putCachedGeocode("Atlantis", null, t0);
    expect(await getCachedGeocode("Atlantis", t0 + 6 * 86_400_000)).toBeNull();
    expect(await getCachedGeocode("Atlantis", t0 + 8 * 86_400_000)).toBeUndefined();
  });

  it("overwrites an entry", async () => {
    await putCachedGeocode("Atlantis", { lat: 1, lon: 2, displayName: "A" });
    expect(await getCachedGeocode("Atlantis")).toEqual({ lat: 1, lon: 2, displayName: "A", countryCode: null });
  });
});
