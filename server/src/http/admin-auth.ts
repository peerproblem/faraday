// Admin login for /admin: one username and password from the environment, and a signed session cookie.
// ADMIN_USERNAME, ADMIN_PASSWORD_HASH ("scrypt:<saltHex>:<hashHex>", crypto.scryptSync(password, salt, 64)) and
// ADMIN_SESSION_SECRET (HMAC key) must all be set, otherwise every login fails.
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { log } from "./log";

export const ADMIN_COOKIE = "fd_admin";
export const ADMIN_SESSION_MS = 12 * 60 * 60_000;

type AdminEnv = { username?: string; passwordHash?: string; secret?: string };

const envOf = (): AdminEnv => ({
  username: process.env.ADMIN_USERNAME,
  passwordHash: process.env.ADMIN_PASSWORD_HASH,
  secret: process.env.ADMIN_SESSION_SECRET,
});

let warned = false;

function configured(env: AdminEnv): env is Required<AdminEnv> {
  const ok = !!(env.username && env.passwordHash && env.secret);
  if (!ok && !warned) {
    warned = true;
    log("warn", "admin login is off: set ADMIN_USERNAME, ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET");
  }
  return ok;
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checks a username and password against the environment. Always runs scrypt so timing does not reveal the username. */
export function checkAdminLogin(username: string, password: string, env: AdminEnv = envOf()): boolean {
  if (!configured(env)) return false;
  const parts = env.passwordHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !parts[1] || !parts[2]) return false;
  const expected = Buffer.from(parts[2], "hex");
  if (!expected.length) return false;
  let got: Buffer;
  try {
    got = scryptSync(password, parts[1], expected.length);
  } catch {
    return false;
  }
  const userOk = safeEqual(Buffer.from(username), Buffer.from(env.username));
  const passOk = safeEqual(got, expected);
  return userOk && passOk;
}

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(`fd_admin.v1.${payload}`).digest("base64url");

/** A session token: "<expiresAtMs>.<signature>". */
export function issueAdminToken(now = Date.now(), env: AdminEnv = envOf()): string | null {
  if (!configured(env)) return null;
  const exp = String(now + ADMIN_SESSION_MS);
  return `${exp}.${sign(exp, env.secret)}`;
}

export function verifyAdminToken(token: string | null | undefined, now = Date.now(), env: AdminEnv = envOf()): boolean {
  if (!token || !configured(env)) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^\d{1,16}$/.test(exp)) return false;
  if (!safeEqual(Buffer.from(mac), Buffer.from(sign(exp, env.secret)))) return false;
  return Number(exp) > now;
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Set-Cookie value. In production (a domain is set) the cookie is Secure and scoped to the domain and its subdomains. */
export function adminCookie(value: string, opts: { domain: string; maxAgeMs: number }): string {
  const parts = [`${ADMIN_COOKIE}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`];
  if (opts.domain) parts.push(`Domain=.${opts.domain}`, "Secure");
  if (opts.maxAgeMs <= 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  return parts.join("; ");
}
