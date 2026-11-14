// Who a source is, for its logo and name: a platform (X, Reddit, YouTube...) or a publisher's site.
// Pure, so the server pages (topic tiles) and the board widgets resolve a source the same way.
import type { Source } from "./spec";
import { glyphs, type Platform } from "./source-glyphs";

/** Hosts that belong to a platform. A subdomain matches too (old.reddit.com, es.wikipedia.org). */
const PLATFORM_HOSTS: Record<string, Platform> = {
  "x.com": "x",
  "twitter.com": "x",
  "reddit.com": "reddit",
  "redd.it": "reddit",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "t.me": "telegram",
  "telegram.me": "telegram",
  "bsky.app": "bluesky",
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "instagram.com": "instagram",
  "tiktok.com": "tiktok",
  "threads.net": "threads",
  "threads.com": "threads",
  "mastodon.social": "mastodon",
  "mastodon.online": "mastodon",
  "wikipedia.org": "wikipedia",
  "github.com": "github",
};

/** Hostname without the prefixes that do not change who published the page. Null for anything but http(s). */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase().replace(/^(?:www|m|mobile|amp)\./, "") || null;
  } catch {
    return null;
  }
}

export function platformOfHost(host: string | null): Platform | null {
  if (!host) return null;
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const hit = PLATFORM_HOSTS[parts.slice(i).join(".")];
    if (hit) return hit;
  }
  return null;
}

export type SourceBrand = {
  /** Groups sources of one outlet: the platform, or the site's host. */
  key: string;
  platform: Platform | null;
  /** "X", "Reddit", or the publisher's name (its host when the name is unknown). */
  name: string;
  host: string | null;
  /** Where the site's logo is served from. Null for platforms (their mark is drawn inline) and for unreadable URLs. */
  logo: string | null;
};

/** A hostname is the only thing that goes into the logo path. */
const SAFE_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const isSafeHost = (host: string) => host.length <= 253 && SAFE_HOST.test(host);

export const logoPath = (host: string) => `/api/source-logo/${host}`;

export function brandOf(s: Pick<Source, "url" | "publisher">): SourceBrand {
  const host = hostOf(s.url);
  const platform = platformOfHost(host);
  if (platform) return { key: platform, platform, name: glyphs[platform].name, host, logo: null };
  const publisher = s.publisher?.trim() || null;
  return { key: host ?? publisher ?? "web", platform: null, name: publisher ?? host ?? "web", host, logo: host && isSafeHost(host) ? logoPath(host) : null };
}

const HANDLE = /^[A-Za-z0-9_.-]{1,60}$/;

/** The account or community a post belongs to ("@civilprotection", "r/spain"), read from its URL. */
export function handleOf(url: string): string | null {
  const platform = platformOfHost(hostOf(url));
  if (!platform) return null;
  let seg: string[];
  try {
    seg = new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
  const ok = (v: string | undefined) => (v && HANDLE.test(v) ? v : null);
  switch (platform) {
    case "x":
      return seg[1] === "status" && ok(seg[0]) ? `@${seg[0]}` : null;
    case "reddit":
      return seg[0] === "r" && ok(seg[1]) ? `r/${seg[1]}` : seg[0] === "user" && ok(seg[1]) ? `u/${seg[1]}` : null;
    case "youtube":
    case "tiktok":
    case "threads":
      return seg[0]?.startsWith("@") && ok(seg[0].slice(1)) ? seg[0] : null;
    case "telegram": {
      const name = seg[0] === "s" ? seg[1] : seg[0];
      return ok(name) ? `@${name}` : null;
    }
    case "bluesky":
      return seg[0] === "profile" && ok(seg[1]) ? `@${seg[1]}` : null;
    case "mastodon":
      return seg[0]?.startsWith("@") && ok(seg[0].slice(1)) ? seg[0] : null;
    default:
      return null;
  }
}

/** What to call a source next to its logo: the account for a post, otherwise the publisher. */
export function sourceLabel(s: Pick<Source, "url" | "publisher">): string {
  const brand = brandOf(s);
  if (!brand.platform) return brand.name;
  const publisher = s.publisher?.trim();
  return handleOf(s.url) ?? (publisher && publisher.toLowerCase() !== brand.name.toLowerCase() ? publisher : brand.name);
}

const cutAtWord = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, "")}…`);

/**
 * A short passage of the source's own words. Search snippets often run on into page furniture ("Copy link",
 * "Swipe for next article"), which follows the first line break, so the first real paragraph is used. A post
 * is its whole text.
 */
export function excerptOf(s: Pick<Source, "snippet" | "title" | "kind">, max = 220): string | null {
  const raw = s.snippet?.trim();
  if (!raw) return null;
  const flat = (t: string) => t.replace(/\s+/g, " ").trim();
  if (s.kind === "social") return cutAtWord(flat(raw), Math.max(max, 280));
  const title = flat(s.title ?? "").toLowerCase();
  const paragraphs = raw.split(/\n+/).map(flat).filter(Boolean);
  const first = paragraphs.find((p) => p.length >= 25 && p.toLowerCase() !== title) ?? paragraphs[0];
  if (!first) return null;
  if (first.length <= max) return first;
  // Prefer whole sentences when one ends inside the limit.
  const sentences = first.slice(0, max).match(/^.*[.!?](?=\s|$)/);
  return sentences && sentences[0].length >= max * 0.5 ? sentences[0] : cutAtWord(first, max);
}

export type Outlet = SourceBrand & { count: number; newest: string | null };

/** Sources grouped by outlet, the most cited first. */
export function outletsOf(sources: Pick<Source, "url" | "publisher" | "publishedAt">[]): Outlet[] {
  const by = new Map<string, Outlet>();
  for (const s of sources) {
    const brand = brandOf(s);
    const hit = by.get(brand.key);
    if (!hit) by.set(brand.key, { ...brand, count: 1, newest: s.publishedAt });
    else {
      hit.count += 1;
      if ((s.publishedAt ?? "") > (hit.newest ?? "")) hit.newest = s.publishedAt;
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || (b.newest ?? "").localeCompare(a.newest ?? "") || a.name.localeCompare(b.name));
}

/**
 * The newest sources with a headline, one per headline, for the wire. Posts are left out: an unverified report
 * is only ever shown under the "unverified" heading of the on-the-ground widget.
 */
export function latestSources<T extends Pick<Source, "url" | "title" | "publishedAt" | "fetchedAt" | "relevance" | "kind" | "sourceType">>(sources: T[], limit = 14): T[] {
  const seen = new Set<string>();
  return sources
    .filter((s) => s.title && s.kind !== "social" && s.sourceType !== "social" && (s.relevance === null || s.relevance >= 0.4))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || b.fetchedAt - a.fetchedAt)
    .filter((s) => {
      const key = s.title!.toLowerCase().replace(/\W+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

/** One headline on the wire. */
export type WireItem = Pick<Source, "id" | "url" | "title" | "publisher" | "publishedAt"> & {
  /** The topic the headline belongs to, on pages that mix several topics. */
  topic?: string | null;
};

/** The newest headlines as wire items. */
export function wireItems(sources: Source[], limit = 14, topic: string | null = null): WireItem[] {
  return latestSources(sources, limit).map((s) => ({ id: s.id, url: s.url, title: s.title, publisher: s.publisher, publishedAt: s.publishedAt, topic }));
}

/** What a topic tile shows about where its board comes from. */
export type TopicSources = { count: number; outletCount: number; outlets: Outlet[]; latest: WireItem[] };

export function summarizeSources(sources: Source[], topic: string | null, opts: { outlets?: number; latest?: number } = {}): TopicSources {
  const outlets = outletsOf(sources);
  return {
    count: sources.length,
    outletCount: outlets.length,
    outlets: outlets.slice(0, opts.outlets ?? 8),
    latest: wireItems(sources, opts.latest ?? 6, topic),
  };
}

/** The newest headlines across several topics, for the home page wire. */
export function mergeWires(all: TopicSources[], limit = 18): WireItem[] {
  return all
    .flatMap((t) => t.latest)
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, limit);
}
