import { createHash } from "node:crypto";
import { cassetteMode, taped } from "../contextdev";
import type { FoundDoc } from "../repo/boards";
import { getSocialCursor, reserveSocialReads } from "../repo/social";
import type { BoardTier } from "../spec";

export const X_BATCH_SIZE = 10;
export type XResponse = {
  data?: { id: string; text: string; author_id?: string; created_at?: string; note_tweet?: { text: string }; note_post?: { text: string } }[];
  includes?: { users?: { id: string; username: string; name?: string }[] };
  meta?: { newest_id?: string; result_count?: number; next_token?: string };
  errors?: unknown[];
};

/** Operators of the X website's search box that API v2 recent search rejects with HTTP 400 ("invalid operator").
 * Planning models write them from habit (-filter:retweets, min_faves:10, since:2026-11-01), and one of them fails the whole request. */
const WEB_ONLY_OPERATOR = /(?<![\w:])-?(?:filter|include|min_faves|min_retweets|min_replies|since|until|near|within|geocode):\S+/gi;

export function xQuery(queries: string[]): string | null {
  const clean = (q: string) => q.replace(WEB_ONLY_OPERATOR, "").replace(/(?<![\w:])-?is:retweet\b/gi, "").replace(/\s+/g, " ").trim();
  const parts = queries.map(clean).filter(Boolean).slice(0, 2);
  if (!parts.length) return null;
  const q = `(${parts.map((p) => `(${p})`).join(" OR ")}) -is:retweet`;
  return q.length <= 512 ? q : null;
}

/** One request, no retries or pagination. Tape the response, never the bearer/header. */
export async function searchX(query: string, opts: { sinceId?: string; signal?: AbortSignal } = {}): Promise<FoundDoc[]> {
  if (opts.sinceId && !/^\d{1,19}$/.test(opts.sinceId)) throw new Error("Invalid X cursor");
  const response = await taped<XResponse>("x.search.recent", [query, opts.sinceId ?? null, X_BATCH_SIZE], async () => {
    const token = process.env.X_API_BEARER_TOKEN;
    if (!token) throw new Error("X_API_BEARER_TOKEN is not set");
    const url = new URL("https://api.x.com/2/tweets/search/recent");
    url.search = new URLSearchParams({ query, max_results: String(X_BATCH_SIZE),
      "post.fields": "author_id,created_at,note_post", expansions: "author_id", "user.fields": "username,name", sort_order: "recency",
      ...(opts.sinceId ? { since_id: opts.sinceId } : {}) }).toString();
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` },
        signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), redirect: "error" });
    } catch {
      // Never forward a transport error containing request headers or credentials.
      throw new Error("X recent search transport failed");
    }
    if (!res.ok) throw new Error(`X recent search HTTP ${res.status}`);
    let body: XResponse;
    try { body = await res.json() as XResponse; }
    catch { throw new Error("Invalid X recent search JSON"); }
    if (body.errors?.length && !body.data) throw new Error("X recent search returned errors");
    if (body.data !== undefined && !Array.isArray(body.data)) throw new Error("Invalid X recent search response");
    return body;
  });
  const users = new Map(response.includes?.users?.map((u) => [u.id, u]));
  return (response.data ?? []).flatMap((post): FoundDoc[] => {
    const user = users.get(post.author_id ?? "");
    if (!/^\d{1,19}$/.test(post.id) || !user || !/^[A-Za-z0-9_]{1,15}$/.test(user.username)) return [];
    const text = post.note_tweet?.text ?? post.note_post?.text ?? post.text;
    if (!text?.trim()) return [];
    return [{ url: `https://x.com/${user.username}/status/${post.id}`, title: `@${user.username}`,
      publisher: `@${user.username}`, publishedAt: post.created_at ?? null, snippet: text, kind: "social", via: "x" }];
  });
}

/** Recent search covers 7 days and rejects an older since_id with HTTP 400, which would fail every later
 * poll of a board that had been quiet for a week. A cursor past the window is dropped instead of sent. */
export function freshCursor(sinceId: string | undefined, now = Date.now()): string | undefined {
  if (!sinceId || !/^\d{1,19}$/.test(sinceId)) return undefined;
  const postedAt = Number((BigInt(sinceId) >> BigInt(22)) + BigInt(1288834974657)); // snowflake timestamp
  return now - postedAt < 6.5 * 86_400_000 ? sinceId : undefined;
}

/** Only live requests reserve credits. Replay needs no credentials and retains per-board cursor semantics. */
export async function gatherX(boardId: string, queries: string[], signal: AbortSignal, opts: { polling?: boolean; tier?: BoardTier } = {}): Promise<FoundDoc[]> {
  if (opts.polling && opts.tier !== "hot") return [];
  if (cassetteMode() !== "replay" && !process.env.X_API_BEARER_TOKEN) return [];
  const query = xQuery(queries);
  if (!query) return [];
  const queryKey = createHash("sha256").update(query).digest("hex");
  const reservation: { sinceId?: string } | null = cassetteMode() === "replay" ? await getSocialCursor(boardId, queryKey) : await reserveSocialReads(boardId, queryKey, X_BATCH_SIZE);
  if (!reservation) return [];
  const docs = await searchX(query, { sinceId: freshCursor(reservation.sinceId), signal });
  // Per-query cursors avoid skipping results when the plan changes its search terms.
  const sinceId = docs.map((d) => d.url.split("/").at(-1)!).sort((a, b) => BigInt(a) < BigInt(b) ? 1 : -1)[0];
  return docs.map((d) => ({ ...d, socialCursor: { queryKey, sinceId } }));
}
