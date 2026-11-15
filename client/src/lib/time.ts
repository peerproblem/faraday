export function toMs(t: string | number | null | undefined): number | null {
  if (t == null) return null;
  const ms = typeof t === "number" ? t : Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

export function ago(t: string | number | null | undefined, now = Date.now()): string {
  const ms = toMs(t);
  if (ms === null) return "unknown";
  const s = Math.round((now - ms) / 1000);
  if (s < 0) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function when(t: string | null | undefined): string {
  if (!t) return "Time unknown";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

/** Short axis label, e.g. "14 Nov 09:00". */
export function shortTime(t: string | number): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

const pacificDateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const pacificDate = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" });
const calendarDate = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

export function pacificReportTime(timestamp: string | number) {
  const ms = toMs(timestamp);
  return ms === null ? String(timestamp) : pacificDateTime.format(ms);
}

export function pacificReportDate(value: string) {
  const ms = toMs(value);
  if (ms === null) return value;
  // Date-only assessments name a calendar day with no time zone.
  return (/^\d{4}-\d{2}-\d{2}$/.test(value) ? calendarDate : pacificDate).format(ms);
}

export const STALE_MS = 24 * 3_600_000;

/** A figure on a board that is checked every few minutes, but whose own time is more than a day old. */
export function isStale(asOf: string | null | undefined, tier: string, now = Date.now()): boolean {
  if (tier !== "hot") return false;
  const ms = toMs(asOf);
  return ms !== null && now - ms > STALE_MS;
}

/** Newest of several ISO times, or null. */
export function newest(times: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const t of times) {
    const ms = toMs(t);
    if (ms !== null && ms > bestMs) {
      bestMs = ms;
      best = t as string;
    }
  }
  return best;
}
