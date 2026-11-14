export function ago(t: string | number | null | undefined, now = Date.now()): string {
  if (t == null) return "unknown";
  const ms = typeof t === "number" ? t : Date.parse(t);
  if (!Number.isFinite(ms)) return "unknown";
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
