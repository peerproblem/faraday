/**
 * Where to send someone after sign-in. Only a path on this site: one leading "/", never "//" or a backslash
 * (browsers read "//host" and "/\host" as another site). Anything else goes to "/".
 */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return "/";
  return next;
}
