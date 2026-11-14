import { describe, expect, it } from "vitest";
import { run } from "../db/pool";
import { useTestDb } from "../test/db";
import { createBoard, getBoard, listTopics, setSchedule } from "./boards";
import { clearSettingsCache, discoverEnabled, getSetting, setDiscoverEnabled } from "./settings";
import { archivePausedTopics, listAdminTopics, setTopicState } from "./topics";

process.env.FARADAY_MONITORS = "off";
const t = useTestDb("repo_settings");

async function liveTopic() {
  const { id } = await createBoard(`topic ${Math.random()}`, null, { origin: "system" });
  // A built topic: listTopics only shows boards with a spec.
  await run(`UPDATE boards SET spec = '{"version":2,"widgets":[]}', status = 'live' WHERE id = ?`, [id]);
  return id;
}

describe.skipIf(!t.enabled)("repo/settings and admin topic state", () => {
  it("starts with discovery off (migration 008) and toggles it", async () => {
    clearSettingsCache();
    expect(await getSetting("discover_enabled")).toBe("0");
    expect(await discoverEnabled()).toBe(false);
    await setDiscoverEnabled(true);
    expect(await discoverEnabled()).toBe(true);
    expect(await getSetting("discover_enabled")).toBe("1");
    await setDiscoverEnabled(false);
    expect(await discoverEnabled()).toBe(false);
  });

  it("treats a missing row as off and caches reads briefly", async () => {
    await run(`DELETE FROM app_settings WHERE name = 'discover_enabled'`);
    clearSettingsCache();
    const now = Date.now();
    expect(await discoverEnabled(now)).toBe(false);
    await run(`INSERT INTO app_settings (name, value, updated_at) VALUES ('discover_enabled', '1', ?)`, [now]);
    expect(await discoverEnabled(now + 1_000)).toBe(false);
    expect(await discoverEnabled(now + 11_000)).toBe(true);
    await setDiscoverEnabled(false);
  });

  it("a paused topic that upkeep archived is active again after it is restored", async () => {
    const id = await liveTopic();
    await setSchedule(id, { tier: "paused", nextPollAt: null });
    expect(await archivePausedTopics()).toContain(id);
    expect((await listTopics({ limit: 100 })).some((b) => b.id === id)).toBe(false);
    expect((await listTopics({ state: "archived", limit: 100 })).some((b) => b.id === id)).toBe(true);
    const now = Date.now();
    expect(await setTopicState(id, "active", now)).toBe(true);
    const row = await getBoard(id);
    expect(row).toMatchObject({ topicState: "active", tier: "warm", nextPollAt: now, lastViewedAt: now });
    expect((await listTopics({ limit: 100 })).some((b) => b.id === id)).toBe(true);
    // Not archived again on the next upkeep.
    expect(await archivePausedTopics()).not.toContain(id);
  });

  it("archives on request (paused), repeats safely, and refuses user boards", async () => {
    const id = await liveTopic();
    expect(await setTopicState(id, "archived")).toBe(true);
    expect(await setTopicState(id, "archived")).toBe(true);
    expect(await getBoard(id)).toMatchObject({ topicState: "archived", tier: "paused", nextPollAt: null });
    const { id: legacy } = await createBoard("legacy board here", "u1");
    expect(await setTopicState(legacy, "active")).toBe(false);
    expect(await setTopicState("missing", "active")).toBe(false);
    const listed = await listAdminTopics();
    expect(listed.some((b) => b.id === id && b.topicState === "archived")).toBe(true);
    expect(listed.some((b) => b.id === legacy)).toBe(false);
  });
});
