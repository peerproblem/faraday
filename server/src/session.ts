import { decode } from "@auth/core/jwt";

// Reads the Auth.js session cookie that the web app sets. In production it is scoped to
// .faraday.watch, so it reaches api.faraday.watch too.
const NAMES = ["__Secure-authjs.session-token", "authjs.session-token"];

/** A cookie value that is not valid percent-encoding ("100%") is kept as it is, so one bad cookie never breaks a request. */
function decodeValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseCookies(header: string | undefined) {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out.set(part.slice(0, i).trim(), decodeValue(part.slice(i + 1).trim()));
  }
  return out;
}

function readChunked(cookies: Map<string, string>, name: string) {
  if (cookies.has(name)) return cookies.get(name)!;
  let value = "";
  for (let i = 0; cookies.has(`${name}.${i}`); i++) value += cookies.get(`${name}.${i}`);
  return value || null;
}

export async function sessionUserId(cookieHeader: string | undefined): Promise<string | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  let cookies: Map<string, string>;
  try {
    cookies = parseCookies(cookieHeader);
  } catch {
    return null;
  }
  for (const name of NAMES) {
    const token = readChunked(cookies, name);
    if (!token) continue;
    try {
      const jwt = await decode({ token, secret, salt: name });
      if (jwt && typeof jwt.uid === "string") return jwt.uid;
    } catch {}
  }
  return null;
}
