// OWNER: F-PIPE-CORE. Geocode cache (guide P3-8).
import { createHash } from "node:crypto";
import { one, run } from "../db/pool";

export type GeoHit = { lat: number; lon: number; displayName: string } | null;

const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const normalizeGeoQuery = (q: string) => q.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const hashOf = (q: string) => createHash("sha256").update(normalizeGeoQuery(q)).digest("hex");

/** undefined = not cached (or an expired miss), null = cached miss, otherwise the hit. */
export async function getCachedGeocode(query: string, now = Date.now()): Promise<GeoHit | undefined> {
  const r = await one<{ lat: number | null; lon: number | null; display_name: string | null; fetched_at: number }>(
    `SELECT lat, lon, display_name, fetched_at FROM geocode_cache WHERE query_hash = ?`,
    [hashOf(query)],
  );
  if (!r) return undefined;
  if (r.lat === null || r.lon === null) return now - Number(r.fetched_at) < MISS_TTL_MS ? null : undefined;
  return { lat: Number(r.lat), lon: Number(r.lon), displayName: r.display_name ?? "" };
}

/** Stores misses too (hit = null) so they are not retried for 7 days. */
export async function putCachedGeocode(query: string, hit: GeoHit, now = Date.now()): Promise<void> {
  await run(
    `INSERT INTO geocode_cache (query_hash, query, lat, lon, display_name, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE query = VALUES(query), lat = VALUES(lat), lon = VALUES(lon), display_name = VALUES(display_name), fetched_at = VALUES(fetched_at)`,
    [hashOf(query), normalizeGeoQuery(query).slice(0, 2000), hit?.lat ?? null, hit?.lon ?? null, hit?.displayName ?? null, now],
  );
}
