// Context.dev monitor lifecycle for a board (guide P4-3). Uses repo/boards monitor rows.
import { NotFoundError } from "context.dev";
import { cassetteMode, ctx, hostOf, type MonitorChange } from "./contextdev";
import { deleteMonitorRow, listMonitors, saveMonitor, setMonitorSeen, type FoundDoc } from "./repo/boards";
import type { Plan } from "./spec";

const MAX_PAGE_MONITORS = 2;

function webhook() {
  const domain = process.env.FARADAY_DOMAIN;
  return domain ? { url: `https://api.${domain}/api/webhooks/context`, events: ["change.detected" as const] } : null;
}

const common = () => {
  const hook = webhook();
  return {
    ...(hook ? { webhook: hook } : {}),
    change_detection: { type: "semantic" as const, confidence_threshold: 0.7 },
    schedule: { type: "interval" as const, frequency: 10, unit: "minutes" as const },
    tags: ["faraday"],
  };
};

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

/**
 * Makes sure the board has its search monitor and up to 2 page monitors on the given official URLs, within the
 * account allowance (hot boards first is the caller's job: pass allowPage=false for non-hot boards).
 * Attaches the webhook (https://api.<FARADAY_DOMAIN>/api/webhooks/context) and stores each monitor's secret.
 * Returns a short note for the run log.
 */
export async function ensureBoardMonitors(boardId: string, plan: Plan, officialUrls: string[], opts?: { allowPage?: boolean }): Promise<string> {
  if (monitorsDisabled()) return "monitors disabled";
  const existing = await listMonitors(boardId);
  const needSearch = !existing.some((m) => m.kind === "search");
  const watched = new Set(existing.filter((m) => m.kind === "page").map((m) => m.target));
  const pageSlots = opts?.allowPage === false ? 0 : Math.max(0, MAX_PAGE_MONITORS - watched.size);
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
  const notes: string[] = [];
  if (needSearch) {
    if (available <= 0) notes.push("monitor limit reached, news polling only");
    else {
      try {
        const m = await ctx().monitors.create({
          ...common(),
          name: `faraday ${plan.title}`.slice(0, 100),
          target: { type: "search", query: plan.monitor.query.slice(0, 500), instructions: plan.monitor.instructions.slice(0, 2000) },
        });
        await saveMonitor({ id: m.id, boardId, kind: "search", target: plan.monitor.query, webhookSecret: m.webhook?.secret ?? null });
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
      const m = await ctx().monitors.create({
        ...common(),
        name: `faraday ${plan.title} ${hostOf(url) ?? ""}`.trim().slice(0, 100),
        target: { type: "page", url, instructions: plan.monitor.instructions.slice(0, 2000) },
      });
      await saveMonitor({ id: m.id, boardId, kind: "page", target: url, webhookSecret: m.webhook?.secret ?? null });
      available -= 1;
      notes.push(`page monitor on ${hostOf(url) ?? url}`);
    } catch (e) {
      notes.push(`page monitor on ${hostOf(url) ?? url} failed: ${errText(e)}`);
    }
  }
  return notes.join("; ");
}

/** Deletes the board's monitors at Context.dev and their rows. Never throws. */
export async function removeBoardMonitors(boardId: string): Promise<number> {
  let removed = 0;
  let rows: Awaited<ReturnType<typeof listMonitors>> = [];
  try {
    rows = await listMonitors(boardId);
  } catch (e) {
    console.error("[faraday] removeBoardMonitors: list failed", boardId, errText(e));
    return 0;
  }
  for (const m of rows) {
    try {
      if (!monitorsDisabled()) await ctx().monitors.delete(m.id);
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

/** New changes since each monitor's last seen change; advances last seen. */
export async function collectMonitorChanges(boardId: string, signal?: AbortSignal): Promise<{ changes: MonitorChange[]; calls: number }> {
  if (monitorsDisabled()) return { changes: [], calls: 0 };
  const changes: MonitorChange[] = [];
  let calls = 0;
  for (const m of await listMonitors(boardId)) {
    calls += 1;
    try {
      const page = await ctx().monitors.listChanges(m.id, { limit: 20 }, { signal });
      const fresh = page.data.filter((c) => !m.lastSeenChangeAt || c.detected_at > m.lastSeenChangeAt);
      if (!fresh.length) continue;
      const newest = fresh.reduce((a, c) => (c.detected_at > a ? c.detected_at : a), fresh[0].detected_at);
      await setMonitorSeen(m.id, newest);
      for (const c of fresh) {
        const evidence: FoundDoc[] = [];
        for (const ev of c.evidence ?? []) {
          if (!ev.url) continue;
          evidence.push({ url: ev.url, title: null, publisher: hostOf(ev.url), publishedAt: c.detected_at, snippet: ev.after || null, kind: "monitor" });
        }
        changes.push({
          monitorId: m.id,
          detectedAt: c.detected_at,
          title: c.title,
          summary: c.summary || c.after_text_excerpt || null,
          url: c.url,
          importance: c.importance ?? null,
          evidence,
        });
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

/** Asks Context.dev to run the board's monitors now. Never throws. */
export async function runBoardMonitors(boardId: string): Promise<void> {
  if (monitorsDisabled()) return;
  try {
    for (const m of await listMonitors(boardId)) {
      await ctx().monitors.run(m.id).catch((e) => console.error("[faraday] monitor run failed", m.id, errText(e)));
    }
  } catch (e) {
    console.error("[faraday] runBoardMonitors failed", boardId, errText(e));
  }
}

/** Turns a monitor change into source documents: the change itself, then its evidence pages. */
export function changeDocs(c: MonitorChange): FoundDoc[] {
  return [
    { url: c.url, title: c.title, publisher: hostOf(c.url), publishedAt: c.detectedAt, snippet: c.summary, kind: "monitor" },
    ...c.evidence,
  ];
}
