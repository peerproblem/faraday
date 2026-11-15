// Posting to X as Faraday's own account. Posts need user context (OAuth 1.0a with the account's access token);
// the app-only bearer token that recent search uses cannot write.
import { createHmac, randomBytes } from "node:crypto";

export type XCreds = { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string };

/** The account's credentials, or null when any is missing (posting to X is then off). */
export function xCreds(env = process.env): XCreds | null {
  const c = {
    consumerKey: env.X_API_CONSUMER_KEY ?? "",
    consumerSecret: env.X_API_SECRET_KEY ?? "",
    token: env.X_API_ACCESS_TOKEN ?? "",
    tokenSecret: env.X_API_ACCESS_SECRET ?? "",
  };
  return Object.values(c).every(Boolean) ? c : null;
}

/** RFC 3986 encoding, as OAuth 1.0a requires (encodeURIComponent leaves !'()* alone). */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The Authorization header for one request. `params` are the query or form parameters that are signed with it;
 * a JSON body is not signed.
 */
export function oauthHeader(
  method: string,
  url: string,
  creds: XCreds,
  params: Record<string, string> = {},
  fixed: { nonce?: string; timestamp?: string } = {},
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: fixed.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: fixed.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.token,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .map((k) => [pct(k), pct(all[k])] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramString)].join("&");
  const key = `${pct(creds.consumerSecret)}&${pct(creds.tokenSecret)}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");
  return (
    "OAuth " +
    Object.entries({ ...oauth, oauth_signature: signature })
      .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
      .join(", ")
  );
}

const POSTS_URL = "https://api.x.com/2/tweets";

/** Publishes one post and returns its id. No retries: a failed post is logged, never sent twice. */
export async function postToX(text: string, creds: XCreds, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(POSTS_URL, {
      method: "POST",
      headers: { Authorization: oauthHeader("POST", POSTS_URL, creds), "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch {
    // Never forward a transport error that could carry the request headers.
    throw new Error("X post transport failed");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`X post HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const body = (await res.json().catch(() => null)) as { data?: { id?: string } } | null;
  const id = body?.data?.id;
  if (!id || !/^\d{1,19}$/.test(id)) throw new Error("X post answered without a post id");
  return id;
}
