// Context.dev monitor lifecycle for a board (guide P4-3). Uses repo/boards monitor rows.
import { frozenBoard } from "./frozen-boards";
import { createHash } from "node:crypto";
import { NotFoundError } from "context.dev";
import { cassetteMode, ctx, hostOf, scrapeMarkdown, type MonitorChange } from "./contextdev";
import {
  ackMonitorChanges,
  deleteMonitorRow,
  listMonitors,
  saveMonitor,
  seenChangeIds,
  updateMonitorRow,
  type FoundDoc,
  type MonitorRow,
} from "./repo/boards";
import { monitorAllowance, type MonitorAllowance } from "./repo/topics";
import type { BoardTier, Plan } from "./spec";

const MAX_PAGE_MONITORS = 2;
/** The checkpoint is re-read with this overlap; change ids drop what was already processed. */
const CHANGE_OVERLAP_MS = 10 * 60_000;
/** How often a poll checks monitor health and settings (the edit graph and tier changes sync at once). */
export const MONITOR_SYNC_MS = 30 * 60_000;
/** Change pages without raw evidence that a poll fetches itself. */
const MAX_CHANGE_SCRAPES = 4;
const SNIPPET_CHARS = 8000;

/** How often Context.dev runs a board's monitors, by tier. Context.dev allows 10 minutes to 1 year. */
export const MONITOR_SCHEDULE_MINUTES: Record<Exclude<BoardTier, "paused">, number> = {
  hot: Number(process.env.MONITOR_HOT_MINUTES ?? 30),
  warm: Number(process.env.MONITOR_WARM_MINUTES ?? 120),
  cold: Number(process.env.MONITOR_COLD_MINUTES ?? 360),
};

const scheduleMinutes = (tier: BoardTier | undefined) =>
  Math.max(10, MONITOR_SCHEDULE_MINUTES[tier && tier !== "paused" ? tier : "hot"] || 10);

function schedule(minutes: number) {
  return minutes % 60 === 0
    ? { type: "interval" as const, frequency: minutes / 60, unit: "hours" as const }
    : { type: "interval" as const, frequency: minutes, unit: "minutes" as const };
}

/** `retry: {}` turns on Context.dev's retry schedule (10 s up to 16 h); without it a failed delivery is retried once. */
function webhook() {
  const domain = process.env.FARADAY_DOMAIN;
  return domain ? { url: `https://api.${domain}/api/webhooks/context`, events: ["change.detected" as const], retry: {} } : null;
}

const CHANGE_DETECTION = { type: "semantic" as const, confidence_threshold: 0.7 };

type SearchTarget = { type: "search"; query: string; instructions: string };
type PageTarget = { type: "page"; url: string; instructions: string };

const searchTarget = (plan: Plan): SearchTarget => ({
  type: "search",
  query: plan.monitor.query.slice(0, 500),
  instructions: plan.monitor.instructions.slice(0, 2000),
});
const pageTarget = (plan: Plan, url: string): PageTarget => ({ type: "page", url, instructions: plan.monitor.instructions.slice(0, 2000) });

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
/** Target half and webhook half, so a change to one does not resend the other (a new target resets the baseline). */
export function configHash(target: SearchTarget | PageTarget, hook = webhook()): string {
  return sha(target).slice(0, 32) + sha(hook).slice(0, 32);
}

export function monitorsDisabled() {
  return process.env.FARADAY_MONITORS === "off" || cassetteMode() !== "off";
}

function normalizeUrl(u: string): string | null {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

const isNotFound = (e: unknown) => e instanceof NotFoundError || (e as { status?: number })?.status === 404;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const live = (rows: MonitorRow[]) => rows.filter((m) => m.remoteStatus !== "dead");
const label = (m: Pick<MonitorRow, "kind" | "target">) => (m.kind === "search" ? "the news search monitor" : `the monitor on ${hostOf(m.target) ?? m.target}`);

/**
 * Makes sure the board has its search monitor and up to 2 page monitors on the given official URLs, within the
 * account allowance (hot boards first is the caller's job: pass allowPage=false for non-hot boards). A URL whose
 * monitor was given up on ('dead') is not watched again. Attaches the webhook
 * (https://api.<FARADAY_DOMAIN>/api/webhooks/context, with retries) and stores each monitor's secret.
 * Shared topics are also limited by rank (monitorAllowance): only the top topics get a search monitor, fewer get
 * page monitors. Returns a short note for the run log.
 */
export async function ensureBoardMonitors(
  boardId: string,
  plan: Plan,
  officialUrls: string[],
  opts?: { allowPage?: boolean; tier?: BoardTier },
): Promise<string> {
  if (monitorsDisabled()) return "monitors disabled";
  let allow: MonitorAllowance;
  try {
    allow = await monitorAllowance(boardId);
  } catch (e) {
    return `monitor allowance unavailable: ${errText(e)}`;
  }
  if (!allow.search) return "not in the monitored topics, news polling only";
  const existing = await listMonitors(boardId);
  const active = live(existing);
  const needSearch = !active.some((m) => m.kind === "search");
  const watched = new Set(existing.filter((m) => m.kind === "page").map((m) => m.target));
  const pageSlots =
    opts?.allowPage === false || !allow.page ? 0 : Math.max(0, MAX_PAGE_MONITORS - active.filter((m) => m.kind === "page").length);
  const pages: string[] = [];
  for (const raw of officialUrls) {
    const u = normalizeUrl(raw);
    if (!u || watched.has(u) || pages.includes(u)) continue;
    if (pages.length >= pageSlots) break;
    pages.push(u);
  }
  if (!needSearch && pages.length === 0) return "monitors already running";

  let available: number;
  try {
    const limits = await ctx().monitors.getLimits();
    available = limits.monitors_limit - limits.monitors_used;
  } catch (e) {
    return `monitor limits unavailable: ${errText(e)}`;
  }
  const minutes = scheduleMinutes(opts?.tier);
  const hook = webhook();
  const common = { ...(hook ? { webhook: hook } : {}), change_detection: CHANGE_DETECTION, schedule: schedule(minutes), tags: ["faraday", `board:${boardId}`] };
  const notes: string[] = [];
  if (needSearch) {
    if (available <= 0) notes.push("monitor limit reached, news polling only");
    else {
      try {
        const target = searchTarget(plan);
        const m = await ctx().monitors.create({ ...common, name: `faraday ${plan.title}`.slice(0, 100), target });
        await saveMonitor({
          id: m.id,
          boardId,
          kind: "search",
          target: plan.monitor.query,
          webhookSecret: m.webhook?.secret ?? null,
          configHash: configHash(target, hook),
          scheduleMinutes: minutes,
        });
        available -= 1;
        notes.push(`search monitor ${m.id}`);
      } catch (e) {
        notes.push(`search monitor failed: ${errText(e)}`);
      }
    }
  }
  for (const url of pages) {
    if (available <= 0) {
      notes.push(`no allowance left for page monitor on ${hostOf(url) ?? url}`);
      continue;
    }
    try {
      const target = pageTarget(plan, url);
      const m = await ctx().monitors.create({ ...common, name: `faraday ${plan.title} ${hostOf(url) ?? ""}`.trim().slice(0, 100), target });
      await saveMonitor({
        id: m.id,
        boardId,
        kind: "page",
        target: url,
        webhookSecret: m.webhook?.secret ?? null,
        configHash: configHash(target, hook),
        scheduleMinutes: minutes,
      });
      available -= 1;
      notes.push(`page monitor on ${hostOf(url) ?? url}`);
    } catch (e) {
      notes.push(`page monitor on ${hostOf(url) ?? url} failed: ${errText(e)}`);
    }
  }
  return notes.join("; ");
}

export type SyncResult = { notes: string[]; alerts: string[] };

/** Why a monitor stopped, from its latest failed or skipped run. */
async function stopReason(id: string): Promise<{ text: string | null; credits: boolean }> {
  try {
    const runs = await ctx().monitors.listRuns(id, { limit: 5 });
    const bad = runs.data.find((r) => r.status === "failed" || r.status === "skipped");
    if (!bad) return { text: null, credits: false };
    return { text: bad.error?.message ?? bad.skip_reason ?? bad.status, credits: bad.skip_reason === "insufficient_credits" };
  } catch {
    return { text: null, credits: false };
  }
}

/**
 * Brings the board's existing monitors in line with the board, and checks their health. Never throws.
 * - Target and instructions follow the plan (after an edit). The search monitor's target only changes when the plan's
 *   query or instructions do, because a new target makes Context.dev take a new baseline.
 * - The webhook gets the retry schedule; the run schedule follows the tier.
 * - Health (at most every MONITOR_SYNC_MS unless `force`): Context.dev pauses or fails a monitor that keeps failing.
 *   A failed page monitor is deleted and its URL not watched again, so the slot goes to another official page; the
 *   search monitor is resumed once. Runs skipped for credits are reported and left alone.
 * `alerts` are short notes for the board's event log.
 */
export async function syncBoardMonitors(boardId: string, plan: Plan, tier: BoardTier, opts: { force?: boolean; now?: number } = {}): Promise<SyncResult> {
  const out: SyncResult = { notes: [], alerts: [] };
  if (monitorsDisabled() || frozenBoard(boardId) || tier === "paused") return out;
  const now = opts.now ?? Date.now();
  let rows: MonitorRow[];
  try {
    rows = live(await listMonitors(boardId));
  } catch (e) {
    out.notes.push(`monitor list failed: ${errText(e)}`);
    return out;
  }
  const hook = webhook();
  const minutes = scheduleMinutes(tier);
  for (const m of rows) {
    try {
      const target = m.kind === "search" ? searchTarget(plan) : pageTarget(plan, m.target);
      const want = configHash(target, hook);
      // Rows from before config hashes: same target if the stored query or url still matches.
      const sameTarget = m.target === (target.type === "search" ? plan.monitor.query : target.url);
      const have = m.configHash ?? (sameTarget ? want.slice(0, 32) : "");
      const patch: Parameters<ReturnType<typeof ctx>["monitors"]["update"]>[1] = {};
      if (have.slice(0, 32) !== want.slice(0, 32)) patch.target = target;
      if (have.slice(32) !== want.slice(32) && hook) patch.webhook = hook;
      if (m.scheduleMinutes !== minutes) patch.schedule = schedule(minutes);
      let status: string | null = null;
      let lastError: string | null | undefined;
      if (Object.keys(patch).length) {
        const res = await ctx().monitors.update(m.id, patch);
        status = res.status;
        lastError = res.last_error?.message ?? null;
        await updateMonitorRow(m.id, {
          configHash: want,
          scheduleMinutes: minutes,
          ...(target.type === "search" ? { target: plan.monitor.query } : {}),
          ...(res.webhook?.secret ? { webhookSecret: res.webhook.secret } : {}),
        });
        out.notes.push(`updated ${label(m)} (${Object.keys(patch).join(", ")})`);
      }
      if (!opts.force && status === null && m.checkedAt !== null && now - m.checkedAt < MONITOR_SYNC_MS) continue;
      if (status === null) {
        const r = await ctx().monitors.retrieve(m.id);
        status = r.status;
        lastError = r.last_error?.message ?? null;
        if (r.webhook_failure) out.notes.push(`webhook failing for ${label(m)}: ${r.webhook_failure.consecutive_failures} in a row`);
      }
      if (status === "active") {
        await updateMonitorRow(m.id, { remoteStatus: "active", lastError: lastError ?? null, checkedAt: now });
        continue;
      }
      const reason = await stopReason(m.id);
      const why = reason.text ?? lastError ?? status;
      const firstTime = m.remoteStatus !== status;
      if (reason.credits) {
        if (firstTime) out.alerts.push(`Context.dev credits ran out, so ${label(m)} is not running`);
        await updateMonitorRow(m.id, { remoteStatus: status as MonitorRow["remoteStatus"], lastError: why, checkedAt: now });
      } else if (m.kind === "page") {
        await ctx().monitors.delete(m.id).catch((e) => {
          if (!isNotFound(e)) throw e;
        });
        await updateMonitorRow(m.id, { remoteStatus: "dead", lastError: why, checkedAt: now });
        out.alerts.push(`Stopped watching ${hostOf(m.target) ?? m.target}: the page kept failing (${clip(why, 160)})`);
      } else if (firstTime && m.lastError !== why) {
        // Resume once per distinct failure; the same failure again is left to the next check.
        const res = await ctx().monitors.update(m.id, { status: "active" });
        await updateMonitorRow(m.id, { remoteStatus: res.status, lastError: why, checkedAt: now });
        out.alerts.push(`Restarted ${label(m)} after it stopped (${clip(why, 160)})`);
      } else {
        await updateMonitorRow(m.id, { lastError: why, checkedAt: now });
        out.notes.push(`${label(m)} still ${status}: ${why}`);
      }
    } catch (e) {
      if (isNotFound(e)) {
        // Gone at Context.dev (deleted there, or never created): drop the row so ensureBoardMonitors recreates it.
        await deleteMonitorRow(m.id).catch(() => {});
        out.notes.push(`${label(m)} no longer exists`);
      } else out.notes.push(`sync of ${label(m)} failed: ${errText(e)}`);
    }
  }
  return out;
}

/** Sets the run schedule of the board's monitors for its tier. Never throws. */
export async function setBoardMonitorSchedule(boardId: string, tier: BoardTier): Promise<number> {
  if (monitorsDisabled() || frozenBoard(boardId) || tier === "paused") return 0;
  const minutes = scheduleMinutes(tier);
  let n = 0;
  try {
    for (const m of live(await listMonitors(boardId))) {
      if (m.scheduleMinutes === minutes) continue;
      try {
        await ctx().monitors.update(m.id, { schedule: schedule(minutes) });
        await updateMonitorRow(m.id, { scheduleMinutes: minutes });
        n += 1;
      } catch (e) {
        if (isNotFound(e)) await deleteMonitorRow(m.id).catch(() => {});
        else console.error("[faraday] monitor schedule update failed", m.id, errText(e));
      }
    }
  } catch (e) {
    console.error("[faraday] setBoardMonitorSchedule failed", boardId, errText(e));
  }
  return n;
}

/** Stop the provider schedule while keeping the monitor and its history. */
export async function pauseBoardMonitors(boardId: string): Promise<void> {
  if (monitorsDisabled()) return;
  for (const monitor of await listMonitors(boardId)) {
    if (monitor.remoteStatus === "paused" || monitor.remoteStatus === "dead") continue;
    try {
      const paused = await ctx().monitors.update(monitor.id, { status: "paused" });
      if (paused.status !== "paused") throw new Error(`Unexpected monitor status: ${paused.status}`);
      await updateMonitorRow(monitor.id, { remoteStatus: "paused", lastError: null, checkedAt: Date.now() });
    } catch (err) {
      if (isNotFound(err)) await updateMonitorRow(monitor.id, { remoteStatus: "dead" });
      else console.error("[faraday] monitor pause failed", monitor.id, errText(err));
    }
  }
}

/** Deletes the board's monitors (or only those of one kind) at Context.dev and their rows. Never throws. */
export async function removeBoardMonitors(boardId: string, opts?: { kind?: MonitorRow["kind"] }): Promise<number> {
  let removed = 0;
  let rows: MonitorRow[] = [];
  try {
    rows = (await listMonitors(boardId)).filter((m) => !opts?.kind || m.kind === opts.kind);
  } catch (e) {
    console.error("[faraday] removeBoardMonitors: list failed", boardId, errText(e));
    return 0;
  }
  for (const m of rows) {
    try {
      if (!monitorsDisabled() && m.remoteStatus !== "dead") await ctx().monitors.delete(m.id);
    } catch (e) {
      if (!isNotFound(e)) {
        // Keep the row so a later cleanup can retry; the monitor still exists at Context.dev.
        console.error("[faraday] monitor delete failed", m.id, errText(e));
        continue;
      }
    }
    try {
      await deleteMonitorRow(m.id);
      removed += 1;
    } catch (e) {
      console.error("[faraday] monitor row delete failed", m.id, errText(e));
    }
  }
  return removed;
}

/**
 * Changes not processed yet, newest first. Reads every page since each monitor's checkpoint (minus a small overlap),
 * and skips change ids already processed. Does not move the checkpoint: call ackChanges once the changes are stored.
 */
export async function collectMonitorChanges(
  boardId: string, signal?: AbortSignal, savePage?: (changes: MonitorChange[]) => Promise<void>,
): Promise<{ changes: MonitorChange[]; calls: number }> {
  if (monitorsDisabled()) return { changes: [], calls: 0 };
  const changes: MonitorChange[] = [];
  let calls = 0;
  for (const m of live(await listMonitors(boardId))) {
    const from = m.lastSeenChangeAt ? Date.parse(m.lastSeenChangeAt) : m.createdAt;
    const since = Number.isFinite(from) ? new Date(from - CHANGE_OVERLAP_MS).toISOString() : undefined;
    try {
      const got: MonitorChange[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        calls += 1;
        const page = await ctx().monitors.listChanges(m.id, { limit: 100, ...(since ? { since } : {}), ...(cursor ? { cursor } : {}) }, { signal });
        const mapped = page.data.map((c): MonitorChange => ({
          id: c.id,
          monitorId: m.id,
          detectedAt: c.detected_at,
          title: c.title,
          summary: c.summary || null,
          url: c.url,
          importance: c.importance ?? null,
          afterExcerpt: c.after_text_excerpt?.trim() ? c.after_text_excerpt : null,
          evidence: (c.evidence ?? []).filter((ev) => ev.after?.trim()).map((ev) => ({ url: ev.url || null, after: ev.after })),
          matchedUrls: c.matched_urls ?? [],
          addedUrls: c.added_urls,
          removedUrls: c.removed_urls,
          beforeExcerpt: c.before_text_excerpt,
          diff: c.diff,
          snapshots: c.evidence?.map((item) => ({ ...item, url: item.url || null })),
        }));
        await savePage?.(mapped);
        got.push(...mapped);
        if (!page.has_more) break;
        if (!page.next_cursor || seenCursors.has(page.next_cursor)) throw new Error("Context.dev monitor pagination did not advance");
        cursor = page.next_cursor;
        seenCursors.add(cursor);
      } while (cursor);
      const seen = await seenChangeIds(got.map((c) => c.id));
      for (const c of got) {
        if (seen.has(c.id) || (since && c.detectedAt < since)) continue;
        seen.add(c.id);
        changes.push(c);
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      if (isNotFound(e)) await deleteMonitorRow(m.id).catch(() => {});
      else console.error("[faraday] monitor changes failed", m.id, errText(e));
    }
  }
  changes.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  return { changes, calls };
}

/** Marks changes as processed and moves the checkpoints. Call after their sources are stored. */
export async function ackChanges(changes: Pick<MonitorChange, "id" | "monitorId" | "detectedAt">[]): Promise<void> {
  if (!changes.length) return;
  await ackMonitorChanges(changes.map((c) => ({ id: c.id, monitorId: c.monitorId, detectedAt: c.detectedAt })));
}

/** Asks Context.dev to run the board's monitors now. Never throws. */
export async function runBoardMonitors(boardId: string): Promise<void> {
  if (monitorsDisabled() || frozenBoard(boardId)) return;
  try {
    for (const m of live(await listMonitors(boardId))) {
      await ctx().monitors.run(m.id).catch((e) => console.error("[faraday] monitor run failed", m.id, errText(e)));
    }
  } catch (e) {
    console.error("[faraday] runBoardMonitors failed", boardId, errText(e));
  }
}

/**
 * Turns a monitor change into source documents, one per URL, carrying only raw page text: the evidence snapshots
 * after the change (evidence without a url belongs to the change's url), else the change's after-text excerpt.
 * The judge model's title and summary are left out, so a fact can never be verified against them. A URL with no raw
 * text gets a null snippet (fetchChangeTexts fills it). Every doc has `refresh`, so a known URL is re-read.
 */
export function changeDocs(c: MonitorChange): FoundDoc[] {
  const texts = new Map<string, string[]>();
  const add = (url: string, text: string) => {
    const list = texts.get(url) ?? [];
    if (!list.includes(text)) list.push(text);
    texts.set(url, list);
  };
  for (const ev of c.evidence) add(ev.url || c.url, ev.after.trim());
  if (!texts.has(c.url) && c.afterExcerpt) add(c.url, c.afterExcerpt.trim());
  const urls = texts.has(c.url) ? [...texts.keys()] : [c.url, ...texts.keys()];
  return urls.map((url) => {
    const t = texts.get(url) ?? [];
    return {
      url,
      title: null,
      publisher: hostOf(url),
      publishedAt: c.detectedAt,
      snippet: t.length ? clip(t.join("\n\n"), SNIPPET_CHARS) : null,
      kind: "monitor" as const,
      via: "contextdev" as const,
      refresh: true,
    };
  });
}

/**
 * Change docs with no raw text get the page as it is now (a fresh scrape), so triage and verification have the source's
 * own words. At most MAX_CHANGE_SCRAPES per call; returns the docs and the number of scrapes.
 */
export async function fetchChangeTexts(docs: FoundDoc[], signal?: AbortSignal): Promise<{ docs: FoundDoc[]; calls: number }> {
  let calls = 0;
  const out: FoundDoc[] = [];
  for (const d of docs) {
    if (d.snippet || calls >= MAX_CHANGE_SCRAPES) {
      out.push(d);
      continue;
    }
    calls += 1;
    const md = await scrapeMarkdown(d.url, signal, { maxAgeMs: 0 });
    out.push(md ? { ...d, snippet: clip(md.trim(), SNIPPET_CHARS) } : d);
  }
  return { docs: out, calls };
}
