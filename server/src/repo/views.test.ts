import { describe, expect, it } from "vitest";
import { all, run } from "../db/pool";
import { emptyLayout, type PersonalLayout } from "../spec";
import { useTestDb } from "../test/db";
import { upsertUser } from "../users";
import { createBoard, deleteBoard, markChanged } from "./boards";
import {
  addTopicRequests,
  countViews,
  deleteView,
  getView,
  KEEP_REVISIONS,
  listCandidates,
  listTopicRequests,
  listViews,
  saveView,
  undoView,
} from "./views";

const { enabled } = useTestDb("repo_views");

const L = (order: string[]): PersonalLayout => ({ ...emptyLayout(1), order });

describe.skipIf(!enabled)("repo/views", () => {
  it("saves with rev checks, keeps the last revisions, undoes step by step and deletes", async () => {
    const user = await upsertUser({ email: "v1@example.com", name: null, image: null });
    const { id } = await createBoard("Floods in Valencia, Spain", null, { origin: "system" });

    expect(await getView(user, id)).toBeNull();
    expect(await saveView(user, id, L(["map"]), 0)).toEqual({ ok: true, rev: 1 });
    // A second "first save" (another tab) is a conflict that returns the stored view.
    expect(await saveView(user, id, L(["feed"]), 0)).toEqual({ ok: false, current: { layout: L(["map"]), rev: 1 } });
    expect(await saveView(user, id, L(["timeline"]), 1, { instruction: "Timeline first", reply: "Done." })).toEqual({ ok: true, rev: 2 });
    expect(await getView(user, id)).toEqual({ layout: L(["timeline"]), rev: 2 });
    expect(await countViews(user)).toBe(1);

    const rev = await all<{ instruction: string | null; reply: string | null }>(
      `SELECT instruction, reply FROM personal_view_revisions WHERE user_id = ? AND board_id = ? AND rev = 2`,
      [user, id],
    );
    expect(rev).toEqual([{ instruction: "Timeline first", reply: "Done." }]);

    // Undo walks back, under ever higher revs, and stops at the first save.
    expect(await undoView(user, id)).toEqual({ layout: L(["map"]), rev: 3 });
    expect(await getView(user, id)).toEqual({ layout: L(["map"]), rev: 3 });
    expect(await undoView(user, id)).toBeNull();
    expect(await saveView(user, id, L(["narrative"]), 2)).toEqual({ ok: false, current: { layout: L(["map"]), rev: 3 } });

    for (let i = 0; i < KEEP_REVISIONS + 5; i++) expect((await saveView(user, id, L([`k${i}`]), 3 + i)).ok).toBe(true);
    const kept = await all<{ n: number }>(`SELECT COUNT(*) AS n FROM personal_view_revisions WHERE user_id = ? AND board_id = ?`, [user, id]);
    expect(Number(kept[0].n)).toBe(KEEP_REVISIONS);

    await deleteView(user, id);
    expect(await getView(user, id)).toBeNull();
    const left = await all<{ n: number }>(`SELECT COUNT(*) AS n FROM personal_view_revisions WHERE user_id = ?`, [user]);
    expect(Number(left[0].n)).toBe(0);
  });

  it("serialises two concurrent first saves", async () => {
    const user = await upsertUser({ email: "v2@example.com", name: null, image: null });
    const { id } = await createBoard("Wildfire near Athens, Greece", null, { origin: "system" });
    const results = await Promise.all([saveView(user, id, L(["a"]), 0), saveView(user, id, L(["b"]), 0)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("lists views with board cards and changedSinceVisit, skipping deleted boards", async () => {
    const user = await upsertUser({ email: "v3@example.com", name: null, image: null });
    const a = await createBoard("Earthquake in Izmir, Turkey", null, { origin: "system" });
    const b = await createBoard("Blackout in Lisbon, Portugal", null, { origin: "system" });
    const c = await createBoard("Storm over Manila", null, { origin: "system" });
    await saveView(user, a.id, L([]), 0, {}, 1_000);
    await saveView(user, b.id, L([]), 0, {}, 2_000);
    await saveView(user, c.id, L([]), 0, {}, 3_000);
    await markChanged(a.id, 5_000);
    await markChanged(b.id, 1_500);
    await deleteBoard(c.id);
    const views = await listViews(user);
    expect(views.map((v) => [v.id, v.origin, v.viewUpdatedAt, v.changedSinceVisit])).toEqual([
      [b.id, "system", 2_000, false],
      [a.id, "system", 1_000, true],
    ]);
  });

  it("stores topic requests and lists them and discovery candidates", async () => {
    const user = await upsertUser({ email: "v4@example.com", name: null, image: null });
    const { id } = await createBoard("Cholera outbreak in Sanaa", null, { origin: "system" });
    await addTopicRequests(id, user, ["shelter capacity", "  ", "school closures"], 10);
    const reqs = await listTopicRequests({ boardId: id });
    expect(reqs.map((r) => [r.text, r.status, r.userId])).toEqual(
      expect.arrayContaining([
        ["shelter capacity", "open", user],
        ["school closures", "open", user],
      ]),
    );
    expect(reqs).toHaveLength(2);
    expect(await listTopicRequests({ boardId: id, status: "accepted" })).toEqual([]);

    await run(
      `INSERT INTO topic_candidates (run_id, fingerprint, title, crisis_type, location_name, entities, score, decision, board_id, reason, evidence, created_at)
       VALUES (7, ?, 'Floods in Valencia', 'flood', 'Valencia, Spain', '["Valencia"]', 0.8, 'created', ?, 'new event', ?, 20)`,
      ["f".repeat(64), id, JSON.stringify([{ url: "https://e.x/a", title: "A", publisher: "E", publishedAt: null }])],
    );
    const cands = await listCandidates(10);
    expect(cands[0]).toEqual({
      id: expect.any(Number),
      runId: 7,
      title: "Floods in Valencia",
      crisisType: "flood",
      locationName: "Valencia, Spain",
      entities: ["Valencia"],
      score: 0.8,
      decision: "created",
      boardId: id,
      reason: "new event",
      evidence: [{ url: "https://e.x/a", title: "A", publisher: "E", publishedAt: null }],
      createdAt: 20,
    });
  });
});
