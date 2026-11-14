// Runtime settings (app_settings). Admins change them from /admin; the worker reads them on its timers.
import { one, run } from "../db/pool";

export type SettingName = "discover_enabled";

export async function getSetting(name: SettingName): Promise<string | null> {
  const r = await one<{ value: string }>(`SELECT value FROM app_settings WHERE name = ?`, [name]);
  return r?.value ?? null;
}

export async function setSetting(name: SettingName, value: string, at = Date.now()): Promise<void> {
  await run(
    `INSERT INTO app_settings (name, value, updated_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
    [name, value, at],
  );
  cache.delete(name);
}

const CACHE_MS = 10_000;
const cache = new Map<SettingName, { value: boolean; at: number }>();

/**
 * Whether the discover job may look for new topics. Off unless an admin turned it on (a missing row is off).
 * Cached for 10 s per process; setSetting in the same process clears it.
 */
export async function discoverEnabled(now = Date.now()): Promise<boolean> {
  const hit = cache.get("discover_enabled");
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const value = (await getSetting("discover_enabled")) === "1";
  cache.set("discover_enabled", { value, at: now });
  return value;
}

export async function setDiscoverEnabled(on: boolean): Promise<void> {
  await setSetting("discover_enabled", on ? "1" : "0");
}

/** Tests only. */
export function clearSettingsCache() {
  cache.clear();
}
