// Runtime settings (app_settings). Admins change them from /admin; the worker reads them on its timers.
import { one, run } from "../db/pool";

export type SettingName = "discover_enabled" | "distribute_live" | "distribute_cursor";

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
type Switch = "discover_enabled" | "distribute_live";
const cache = new Map<SettingName, { value: boolean; at: number }>();

/** An on/off setting. A missing row is off. Cached for 10 s per process; setSetting in the same process clears it. */
async function switchOn(name: Switch, now: number): Promise<boolean> {
  const hit = cache.get(name);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const value = (await getSetting(name)) === "1";
  cache.set(name, { value, at: now });
  return value;
}

/** Whether the discover job may look for new topics. Off unless an admin turned it on. */
export const discoverEnabled = (now = Date.now()) => switchOn("discover_enabled", now);

export async function setDiscoverEnabled(on: boolean): Promise<void> {
  await setSetting("discover_enabled", on ? "1" : "0");
}

/**
 * Whether the distributor really posts to X and Discord. Off unless an admin turned it on: while off it only records
 * what it would post (a dry run), so the cursor keeps up and turning it on never posts the backlog.
 */
export const distributeLive = (now = Date.now()) => switchOn("distribute_live", now);

export async function setDistributeLive(on: boolean): Promise<void> {
  await setSetting("distribute_live", on ? "1" : "0");
}

/** Tests only. */
export function clearSettingsCache() {
  cache.clear();
}
