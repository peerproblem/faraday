import { createHmac, timingSafeEqual } from "node:crypto";

/** Context.dev webhook signature: header "t=<unix seconds>,v1=<hex hmac-sha256 of `${t}.${body}`>". */
export function verifySignature(raw: string, header: string | undefined, secret: string, nowMs = Date.now()) {
  if (!header) return false;
  const parts: Record<string, string> = {};
  for (const p of header.split(",")) {
    const i = p.indexOf("=");
    if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  if (!parts.t || !parts.v1) return false;
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex"));
  const got = Buffer.from(parts.v1);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function sign(raw: string, secret: string, nowMs = Date.now()) {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
}

/** Constant-time check of "Bearer <INTERNAL_API_KEY>". */
export function bearerOk(header: string | undefined, key = process.env.INTERNAL_API_KEY) {
  if (!key || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
