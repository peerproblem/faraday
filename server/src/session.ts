import { decode } from "@auth/core/jwt";

// Reads the Auth.js session cookie that the web app sets. In production it is scoped to
// .faraday.watch, so it reaches api.faraday.watch too.
const NAMES = ["__Secure-authjs.session-token", "authjs.session-token"];

function parseCookies(header: string | undefined) {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
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
  const cookies = parseCookies(cookieHeader);
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
