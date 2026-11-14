type Level = "debug" | "info" | "warn" | "error";

/** One JSON object per line, picked up by journald. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export function errMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
