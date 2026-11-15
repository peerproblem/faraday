import { describe, expect, it } from "vitest";
import { run } from "../db/pool";
import { useTestDb } from "../test/db";
import { createBoard } from "./boards";
import { listCandidates } from "./candidates";

const { enabled } = useTestDb("repo_candidates");

describe.skipIf(!enabled)("repo/candidates", () => {
  it("reads what the discover job saw and decided, newest first", async () => {
    const { id } = await createBoard("Floods in Valencia, Spain", null, { origin: "system" });
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
