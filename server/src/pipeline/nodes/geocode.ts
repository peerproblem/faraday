import { getCachedGeocode, putCachedGeocode, type GeoHit } from "../../repo/geocode";
import { updatePlaceCoords } from "../../repo/facts";
import type { Fact, Location, Plan } from "../../spec";
import { LIMITS } from "./util";

const USER_AGENT = "faraday-board-builder/1.0 (+https://faraday.watch)";
const MIN_GAP_MS = 1_100;

// Nominatim allows one request per second per application, so every call in the process shares one queue.
let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

export const normQuery = (q: string) => q.trim().replace(/\s+/g, " ").toLowerCase();

const isoCountry = (c: unknown) => (typeof c === "string" && /^[a-z]{2}$/i.test(c) ? c.toUpperCase() : null);

export async function geocode(
  query: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  opts: { skipCache?: boolean } = {},
): Promise<GeoHit> {
  const q = normQuery(query);
  if (!q) return null;
  const cached = opts.skipCache ? undefined : await getCachedGeocode(q);
  if (cached !== undefined) return cached;
  const ok = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };
  const nominatim = async (): Promise<GeoHit> => {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`;
    const res = await fetchImpl(url, { headers, signal });
    if (!res.ok) throw new Error(`nominatim answered ${res.status}`);
    const r = ((await res.json()) as { lat: string; lon: string; display_name: string; address?: { country_code?: string } }[])[0];
    if (!r) return null;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    return ok(lat, lon) ? { lat, lon, displayName: r.display_name, countryCode: isoCountry(r.address?.country_code) } : null;
  };
  // Photon (also OpenStreetMap data) answers when Nominatim rate-limits this address.
  const photon = async (): Promise<GeoHit> => {
    const res = await fetchImpl(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}`, { headers, signal });
    if (!res.ok) throw new Error(`photon answered ${res.status}`);
    const f = ((await res.json()) as {
      features?: { geometry?: { coordinates?: number[] }; properties?: { name?: string; country?: string; countrycode?: string } }[];
    }).features?.[0];
    const [lon, lat] = f?.geometry?.coordinates ?? [];
    if (typeof lat !== "number" || typeof lon !== "number" || !ok(lat, lon)) return null;
    return {
      lat,
      lon,
      displayName: [f?.properties?.name, f?.properties?.country].filter(Boolean).join(", "),
      countryCode: isoCountry(f?.properties?.countrycode),
    };
  };
  const hit = await throttled(async () => {
    try {
      return await nominatim();
    } catch (e) {
      if (signal?.aborted) throw e;
      return photon();
    }
  });
  await putCachedGeocode(q, hit);
  return hit;
}

const countryMemo = new Map<string, string | null>();

/**
 * ISO 3166-1 alpha-2 country (upper case) of a place name, from the geocoder, never from a model. Used to route local
 * search. A cached hit stored before country codes were recorded is fetched again once; results are memoised per process.
 */
export async function placeCountry(name: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const key = normQuery(name);
  if (!key) return null;
  if (countryMemo.has(key)) return countryMemo.get(key) ?? null;
  let hit = await geocode(name, signal, fetchImpl);
  if (hit && !hit.countryCode) hit = await geocode(name, signal, fetchImpl, { skipCache: true });
  const code = hit?.countryCode ?? null;
  countryMemo.set(key, code);
  return code;
}

/** Test hook. */
export function __clearCountryMemo() {
  countryMemo.clear();
}

export type GeocodeResult = { location: Location | null; placed: number; missed: number };

/** Geocodes the plan's location and up to 15 places without coordinates; writes coordinates to the facts. */
export async function geocodeBoard(plan: Plan, facts: Fact[], signal: AbortSignal): Promise<GeocodeResult> {
  let location: Location | null = null;
  if (plan.location) {
    const hit = await geocode(plan.location.name, signal).catch(() => null);
    if (hit) location = { name: plan.location.name, lat: hit.lat, lon: hit.lon, zoom: plan.location.zoom };
  }
  const context = plan.location?.name ?? "";
  const places = facts
    .filter((f): f is Fact<"place"> => f.kind === "place" && f.status === "active")
    .filter((f) => typeof f.payload.lat !== "number" || typeof f.payload.lon !== "number")
    .slice(0, LIMITS.maxPlacesToGeocode);
  let placed = 0;
  let missed = 0;
  for (const f of places) {
    const name = f.payload.name;
    const country = context.split(",").pop()?.trim() ?? "";
    const q = country && !name.toLowerCase().includes(country.toLowerCase()) ? `${name}, ${context}` : name;
    const hit = await geocode(q, signal).catch(() => null);
    if (hit) {
      await updatePlaceCoords(f.id, hit.lat, hit.lon);
      f.payload.lat = hit.lat;
      f.payload.lon = hit.lon;
      placed += 1;
    } else missed += 1;
  }
  return { location, placed, missed };
}
