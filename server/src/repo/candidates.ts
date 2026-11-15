// Admin reads of the discovery candidates. Pure data access.
import { all, json } from "../db/pool";
import type { CandidateDecision, TopicCandidateView } from "../spec";

const num = (v: unknown) => Number(v);

const DECISIONS = new Set<CandidateDecision>(["created", "matched", "rejected", "deferred"]);

/** What the discover job saw and decided, newest first. */
export async function listCandidates(limit = 100): Promise<TopicCandidateView[]> {
  const rows = await all<{
    id: number;
    run_id: number;
    title: string;
    crisis_type: string;
    location_name: string | null;
    entities: string;
    score: number;
    decision: string;
    board_id: string | null;
    reason: string | null;
    evidence: string;
    created_at: number;
  }>(
    `SELECT id, run_id, title, crisis_type, location_name, entities, score, decision, board_id, reason, evidence, created_at
     FROM topic_candidates ORDER BY created_at DESC, id DESC LIMIT ?`,
    [Math.max(1, Math.min(500, Math.floor(limit)))],
  );
  const safe = <T>(v: string, d: T): T => {
    try {
      return json<T>(v) ?? d;
    } catch {
      return d;
    }
  };
  return rows.map((r) => ({
    id: num(r.id),
    runId: num(r.run_id),
    title: r.title,
    crisisType: r.crisis_type,
    locationName: r.location_name,
    entities: safe<unknown[]>(r.entities, []).filter((e): e is string => typeof e === "string"),
    score: Number(r.score),
    decision: DECISIONS.has(r.decision as CandidateDecision) ? (r.decision as CandidateDecision) : "deferred",
    boardId: r.board_id,
    reason: r.reason,
    evidence: safe<TopicCandidateView["evidence"]>(r.evidence, []),
    createdAt: num(r.created_at),
  }));
}
