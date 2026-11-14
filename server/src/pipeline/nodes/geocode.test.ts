import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repo/geocode", () => ({ getCachedGeocode: vi.fn(), putCachedGeocode: vi.fn() }));
vi.mock("../../repo/facts", () => ({ updatePlaceCoords: vi.fn() }));

const { getCachedGeocode, putCachedGeocode } = await import("../../repo/geocode");
const { __clearCountryMemo, geocode, placeCountry } = await import("./geocode");

const nominatim = (country_code?: string) =>
  vi.fn(async () => new Response(JSON.stringify([{ lat: "50.45", lon: "30.52", display_name: "Kyiv, Ukraine", address: { country_code } }]), { status: 200 }));

beforeEach(() => {
  vi.mocked(getCachedGeocode).mockReset();
  vi.mocked(putCachedGeocode).mockReset();
  __clearCountryMemo();
});

describe("geocode country codes", () => {
  it("asks Nominatim for address details and stores the upper-case country code", async () => {
    vi.mocked(getCachedGeocode).mockResolvedValueOnce(undefined);
    const fetchImpl = nominatim("ua");
    const hit = await geocode("Kyiv", undefined, fetchImpl as never);
    expect(hit).toEqual({ lat: 50.45, lon: 30.52, displayName: "Kyiv, Ukraine", countryCode: "UA" });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain("addressdetails=1");
    expect(putCachedGeocode).toHaveBeenCalledWith("kyiv", hit);
  });

  it("takes the country from Photon when Nominatim fails", async () => {
    vi.mocked(getCachedGeocode).mockResolvedValueOnce(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ features: [{ geometry: { coordinates: [30.52, 50.45] }, properties: { name: "Kyiv", country: "Ukraine", countrycode: "UA" } }] }), {
          status: 200,
        }),
      );
    expect((await geocode("Kyiv", undefined, fetchImpl as never))?.countryCode).toBe("UA");
  });

  it("ignores a malformed country code", async () => {
    vi.mocked(getCachedGeocode).mockResolvedValueOnce(undefined);
    expect((await geocode("Kyiv", undefined, nominatim("ukr") as never))?.countryCode).toBeNull();
  });
});

describe("placeCountry", () => {
  it("uses a cached code without fetching", async () => {
    vi.mocked(getCachedGeocode).mockResolvedValueOnce({ lat: 1, lon: 2, displayName: "Kyiv", countryCode: "UA" });
    const fetchImpl = vi.fn();
    expect(await placeCountry("Kyiv, Ukraine", undefined, fetchImpl as never)).toBe("UA");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refetches once when the cached hit predates country codes, then memoises", async () => {
    vi.mocked(getCachedGeocode).mockResolvedValue({ lat: 1, lon: 2, displayName: "Kyiv", countryCode: null });
    const fetchImpl = nominatim("ua");
    expect(await placeCountry("Kyiv", undefined, fetchImpl as never)).toBe("UA");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await placeCountry("  kyiv ", undefined, fetchImpl as never)).toBe("UA");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null for an empty name or a miss", async () => {
    expect(await placeCountry("  ")).toBeNull();
    vi.mocked(getCachedGeocode).mockResolvedValue(null);
    expect(await placeCountry("Atlantis", undefined, vi.fn() as never)).toBeNull();
  });

  it("asks again for a miss after a while instead of keeping it until a restart", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-15T00:00:00Z"), toFake: ["Date"] });
    try {
      vi.mocked(getCachedGeocode).mockResolvedValue(null);
      expect(await placeCountry("Kyiv", undefined, vi.fn() as never)).toBeNull();
      expect(getCachedGeocode).toHaveBeenCalledTimes(1);
      expect(await placeCountry("Kyiv", undefined, vi.fn() as never)).toBeNull();
      expect(getCachedGeocode).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.parse("2026-11-15T00:11:00Z"));
      vi.mocked(getCachedGeocode).mockResolvedValue({ lat: 1, lon: 2, displayName: "Kyiv", countryCode: "UA" });
      expect(await placeCountry("Kyiv", undefined, vi.fn() as never)).toBe("UA");
    } finally {
      vi.useRealTimers();
    }
  });
});
