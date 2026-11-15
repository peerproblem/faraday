// Admin reads: what the discover job saw, and the admin switches.

export type CandidateDecision = "created" | "matched" | "rejected" | "deferred";

/** GET /api/admin/candidates: what the discover job saw and decided. */
export type TopicCandidateView = {
  id: number;
  runId: number;
  title: string;
  crisisType: string;
  locationName: string | null;
  entities: string[];
  score: number;
  decision: CandidateDecision;
  boardId: string | null;
  reason: string | null;
  evidence: { url: string; title: string; publisher: string | null; publishedAt: string | null }[];
  createdAt: number;
};

/**
 * GET /api/admin/settings. distributeLive: posts really go out to X and Discord (off: they are only recorded).
 * distributeReady: the engine runs its distribution loop and has an X or Discord account, so distributeLive takes effect.
 */
export type AdminSettings = { discoverEnabled: boolean; distributeLive: boolean; distributeReady: boolean };
