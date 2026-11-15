import { frozenBoard } from "../../frozen-boards";
// Discover graph (spec 5.1): find crises the world is talking about and turn new ones into shared topics.
// Runs on the SYSTEM board, which has no boards row: never call ctx.event or ctx.emit here. Every candidate and its
// decision goes to topic_candidates instead, and a summary line goes to the worker log.
import type { GraphFn } from "../../graph/runner";
import { searchNews, type FoundDoc } from "../../contextdev";
import { THRESHOLDS } from "../../llm/thresholds";
import { addSources, createBoard } from "../../repo/boards";
import { enqueue } from "../../repo/jobs";
import { discoverEnabled } from "../../repo/settings";
import {
  candidateScore,
  countActiveTopics,
  countDiscoveredSince,
  fingerprint,
  lastDiscoverAt,
  matchableTopics,
  reactivateTopic,
  recentlyRejected,
  recordCandidates,
  SKIPPED_PREFIX,
  TOPIC_LIMITS,
  type CandidateRecord,
  type Evidence,
  type TopicRow,
} from "../../repo/topics";
import type { CrisisType } from "../../spec";
import { clusterArticles, DISCOVERY_QUERIES, type Cluster } from "../discover/cluster";
import { mayBeSameEvent, needsBoardProbability, sameEventProbability, topicPrompt, type CandidateView } from "../discover/judge";
import { dedupeDocs } from "../nodes/gather";
import { hostOf } from "../nodes/util";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Candidates that go through matching and the gate per run (each costs model calls); the rest wait. */
const MAX_JUDGED = 8;
/** Existing topics compared with one candidate. */
const MAX_PAIRS = 3;
const SCAN_LIMIT = 20;

type Candidate = Cluster & { fp: string; score: number; docs: FoundDoc[]; evidence: Evidence[] };

const short = (fp: string) => fp.slice(0, 16);
const pct = (p: number) => p.toFixed(2);

function toEvidence(d: FoundDoc): Evidence {
  return { url: d.url, title: (d.title ?? d.url).slice(0, 300), publisher: d.publisher ?? hostOf(d.url), publishedAt: d.publishedAt };
}

/** Merges clusters that share a fingerprint (the model split one event), then scores them, best first. */
export function buildCandidates(clusters: Cluster[], docs: FoundDoc[], now: number): Candidate[] {
  const byFp = new Map<string, Cluster>();
  for (const c of clusters) {
    const fp = fingerprint(c);
    const prev = byFp.get(fp);
    if (!prev) byFp.set(fp, { ...c, articleIdx: [...c.articleIdx] });
    else {
      prev.articleIdx = [...new Set([...prev.articleIdx, ...c.articleIdx])];
      prev.entities = [...new Set([...prev.entities, ...c.entities])].slice(0, 8);
      prev.ongoing = prev.ongoing || c.ongoing;
    }
  }
  const out: Candidate[] = [];
  for (const [fp, c] of byFp) {
    const arts = c.articleIdx.map((i) => docs[i]).filter(Boolean);
    const publishers = new Set(arts.map((d) => (d.publisher ?? hostOf(d.url) ?? d.url).toLowerCase()));
    const times = arts.map((d) => Date.parse(d.publishedAt ?? "")).filter((t) => Number.isFinite(t) && t <= now + HOUR);
    const newestAt = times.length ? Math.max(...times) : null;
    const score = candidateScore({ crisisType: c.crisisType as CrisisType, publishers: publishers.size, articles: arts.length, newestAt }, now);
    out.push({ ...c, fp, score, docs: arts, evidence: arts.map(toEvidence) });
  }
  return out.sort((a, b) => b.score - a.score);
}

const view = (c: Candidate): CandidateView => ({
  title: c.title,
  crisisType: c.crisisType,
  locationName: c.locationName,
  entities: c.entities,
  headlines: c.docs.map((d) => d.title ?? "").filter(Boolean),
});

export const discoverGraph: GraphFn = async (ctx) => {
  // An admin may have turned discovery off after this run was queued: stop before any search or model call.
  if (!(await discoverEnabled())) {
    logLine("discover skipped: discovery is off", { runId: ctx.runId });
    return;
  }
  const now = Date.now();
  const last = await lastDiscoverAt();
  // Overlap the previous run by an hour; never look back more than two days.
  const since = Math.max(now - 2 * DAY, (last ?? now - DAY) - HOUR);

  const scan = await ctx.step(
    "scan",
    { since, queries: DISCOVERY_QUERIES },
    async (i, use, signal) => {
      const failures: string[] = [];
      const results = await Promise.all(
        i.queries.map((q) =>
          searchNews(q, i.since, SCAN_LIMIT, signal).catch((e) => {
            failures.push(`${q}: ${(e as Error).message}`);
            return [] as FoundDoc[];
          }),
        ),
      );
      use.context(i.queries.length);
      if (failures.length === i.queries.length) throw new Error(`every scan query failed (${failures[0]})`);
      return { docs: dedupeDocs(results.flat()), failures };
    },
    { timeoutMs: 60_000 },
  );
  if (!scan.docs.length) {
    logLine("discover: no articles", { failures: scan.failures.length });
    return;
  }

  const clusters = await ctx.step(
    "cluster",
    { urls: scan.docs.map((d) => d.url) },
    (_i, use, signal) => clusterArticles(scan.docs, use, signal, new Date(now)),
    { timeoutMs: 90_000, retries: 1 },
  );
  const candidates = buildCandidates(clusters, scan.docs, now);

  const rejectedBefore = await recentlyRejected(candidates.map((c) => c.fp), DAY, now);
  const topics: TopicRow[] = await matchableTopics(now);
  const minScore = TOPIC_LIMITS.minScore();
  const limits = { perRun: TOPIC_LIMITS.newPerRun(), perDay: TOPIC_LIMITS.newPerDay(), maxActive: TOPIC_LIMITS.maxActive() };
  const createdToday = await countDiscoveredSince(now - DAY);
  const active = await countActiveTopics();
  let created = 0;
  let judged = 0;
  const records: CandidateRecord[] = [];

  for (const c of candidates) {
    const rec = (decision: CandidateRecord["decision"], reason: string, boardId: string | null = null) =>
      records.push({
        runId: ctx.runId,
        fingerprint: c.fp,
        title: c.title,
        crisisType: c.crisisType,
        locationName: c.locationName,
        entities: c.entities,
        score: c.score,
        decision,
        boardId,
        reason,
        evidence: c.evidence,
      });

    if (!c.ongoing) {
      rec("rejected", "the event is over");
      continue;
    }
    if (c.score < minScore) {
      rec("rejected", `score ${pct(c.score)} is below ${pct(minScore)}`);
      continue;
    }
    if (rejectedBefore.has(c.fp)) {
      rec("rejected", `${SKIPPED_PREFIX}rejected in the last 24 hours`);
      continue;
    }
    if (judged >= MAX_JUDGED) {
      rec("deferred", `over the ${MAX_JUDGED} candidates judged per run`);
      continue;
    }
    judged += 1;
    const key = short(c.fp);

    // Match against existing topics: cheap filter first, then the model.
    let best: { topic: TopicRow; p: number } | null = null;
    let compareFailed = false;
    // Same crisis type first, so the MAX_PAIRS budget goes to the likeliest matches.
    const pairs = topics.filter((t) => mayBeSameEvent(c, t)).sort((a, b) => Number(b.crisisType === c.crisisType) - Number(a.crisisType === c.crisisType));
    for (const t of pairs.slice(0, MAX_PAIRS)) {
      const p = await ctx.step(
        "match",
        { fp: c.fp, topic: t.id },
        (_i, use, signal) => sameEventProbability(view(c), t, use, signal),
        { key: `${key}:${t.id}`, timeoutMs: 20_000, retries: 1, optional: true, fallback: null as number | null },
      );
      if (p === null) compareFailed = true;
      else if (!best || p > best.p) best = { topic: t, p };
    }
    if (best && best.p >= THRESHOLDS.sameEvent) {
      const t = best.topic;
      if (frozenBoard(t.id)) {
        rec("matched", "matched a saved board", t.id);
        continue;
      }
      const routed = await ctx.step(
        "route",
        { fp: c.fp, topic: t.id, urls: c.docs.map((d) => d.url) },
        async () => {
          const added = await addSources(t.id, c.docs);
          const reactivated = t.topicState === "archived" ? await reactivateTopic(t.id, now) : false;
          if (added.length || reactivated) await enqueue("poll", t.id, { reason: "discover" });
          return { added: added.length, reactivated };
        },
        { key: `${key}:${t.id}`, timeoutMs: 20_000 },
      );
      if (routed.reactivated) t.topicState = "active";
      rec(
        "matched",
        `same event as "${t.title}" (p=${pct(best.p)}); ${routed.added} new sources${routed.reactivated ? "; topic reactivated" : ""}`,
        t.id,
      );
      continue;
    }
    if (compareFailed) {
      rec("deferred", "could not compare with existing topics");
      continue;
    }

    const live = await ctx.step(
      "gate",
      { fp: c.fp, title: c.title },
      (_i, use, signal) => needsBoardProbability(view(c), use, signal),
      { key, timeoutMs: 20_000, retries: 1, optional: true, fallback: null as number | null },
    );
    if (live === null) {
      rec("deferred", "could not judge whether it needs a live board");
      continue;
    }
    if (live < THRESHOLDS.newTopic) {
      rec("rejected", `not an ongoing crisis that needs a live board (p=${pct(live)})`);
      continue;
    }
    if (created >= limits.perRun) {
      rec("deferred", `run limit of ${limits.perRun} new topics reached`);
      continue;
    }
    if (createdToday + created >= limits.perDay) {
      rec("deferred", `daily limit of ${limits.perDay} new topics reached`);
      continue;
    }
    if (active + created >= limits.maxActive) {
      rec("deferred", `${limits.maxActive} active topics already`);
      continue;
    }

    const made = await ctx.step(
      "create",
      { fp: c.fp, title: c.title },
      async () => {
        const b = await createBoard(topicPrompt(c), null, {
          origin: "system",
          entities: c.entities,
          locationName: c.locationName,
          discoveredAt: now,
        });
        // Seed the evidence; the build's own gather dedupes against it by URL.
        await addSources(b.id, c.docs);
        await enqueue("build", b.id, {});
        return b;
      },
      { key, timeoutMs: 20_000 },
    );
    created += 1;
    // Later candidates in this run match the new topic instead of making a second one.
    topics.push({
      id: made.id,
      title: c.title,
      crisisType: c.crisisType,
      locationName: c.locationName,
      entities: c.entities,
      topicState: "active",
      headline: null,
    });
    rec("created", `new topic (live p=${pct(live)}, score ${pct(c.score)})`, made.id);
  }

  await ctx.step("record", { n: records.length, fps: records.map((r) => r.fingerprint) }, async () => recordCandidates(records, now), {
    timeoutMs: 20_000,
  });
  const count = (d: CandidateRecord["decision"]) => records.filter((r) => r.decision === d).length;
  logLine("discover done", {
    articles: scan.docs.length,
    failedQueries: scan.failures.length,
    candidates: records.length,
    created: count("created"),
    matched: count("matched"),
    rejected: count("rejected"),
    deferred: count("deferred"),
  });
};

function logLine(msg: string, extra: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg, proc: "worker", ...extra }));
}
