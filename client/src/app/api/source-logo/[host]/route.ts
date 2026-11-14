// A publisher's logo by hostname, for the source marks on boards and topic tiles.
// The browser only ever talks to Faraday: the icon is fetched here and cached hard, so a visitor's reading list
// is not sent to a third party, and the upstream can be swapped (for example for the Context.dev Brand API)
// without touching the UI. A miss answers 404 and the mark falls back to the publisher's initial.
import { isSafeHost } from "@/lib/source-brand";

const WEEK = 7 * 24 * 3600;
const hit = `public, max-age=${WEEK}, s-maxage=${4 * WEEK}, stale-while-revalidate=${4 * WEEK}`;
const miss = "public, max-age=3600, s-maxage=86400";

const upstreams = (host: string) => [
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
  `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
];

const MAX_BYTES = 200_000;

export async function GET(_req: Request, { params }: { params: Promise<{ host: string }> }) {
  const host = (await params).host.toLowerCase();
  // Only a plain hostname is accepted, and it only ever becomes a query value of a fixed upstream.
  if (!isSafeHost(host)) return new Response(null, { status: 400 });
  for (const url of upstreams(host)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: "follow" });
      const type = res.headers.get("content-type") ?? "";
      // No SVG: it is the one image type that can carry script when opened on this origin.
      if (!res.ok || !type.startsWith("image/") || type.includes("svg")) continue;
      const body = await res.arrayBuffer();
      if (!body.byteLength || body.byteLength > MAX_BYTES) continue;
      return new Response(body, { headers: { "Content-Type": type, "Cache-Control": hit, "X-Content-Type-Options": "nosniff" } });
    } catch {
      // Try the next upstream.
    }
  }
  return new Response(null, { status: 404, headers: { "Cache-Control": miss } });
}
