// Shared by server and browser code. Values are inlined at build time.

/** Production domain, e.g. faraday.watch. Empty in local development. */
export const DOMAIN = process.env.NEXT_PUBLIC_FARADAY_DOMAIN ?? "";

/** Public engine origin the browser talks to. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || (DOMAIN ? `https://api.${DOMAIN}` : "http://localhost:4000");

/** Main site origin. Board subdomains link back to it. */
export const SITE_URL = DOMAIN ? `https://${DOMAIN}` : "";

export const api = (path: string) => `${API_URL}${path}`;

/** Where a published board lives: <slug>.faraday.watch in production, /b/<slug> locally. */
export const boardUrl = (slug: string) => (DOMAIN ? `https://${slug}.${DOMAIN}` : `/b/${slug}`);

/** The board slug when the host is a board subdomain, otherwise null. */
export function boardSlugFromHost(host: string | null | undefined): string | null {
  if (!DOMAIN || !host) return null;
  const h = host.split(":")[0].toLowerCase();
  if (!h.endsWith(`.${DOMAIN}`)) return null;
  const sub = h.slice(0, -DOMAIN.length - 1);
  if (!sub || sub.includes(".") || sub === "www" || sub === "api") return null;
  return sub;
}
