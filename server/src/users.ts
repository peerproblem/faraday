import { randomUUID } from "node:crypto";
import { one, run } from "./db/pool";

export async function upsertUser(u: { email: string; name: string | null; image: string | null }): Promise<string> {
  const existing = await one<{ id: string }>(`SELECT id FROM users WHERE email = ?`, [u.email]);
  if (existing) {
    await run(`UPDATE users SET name = ?, image = ? WHERE id = ?`, [u.name, u.image, existing.id]);
    return existing.id;
  }
  const id = randomUUID();
  await run(`INSERT INTO users (id, email, name, image, created_at) VALUES (?, ?, ?, ?, ?)`, [
    id,
    u.email,
    u.name,
    u.image,
    Date.now(),
  ]);
  return id;
}

export type UserRow = { id: string; email: string; name: string | null; image: string | null };

export async function getUser(id: string): Promise<UserRow | null> {
  return (await one<UserRow>(`SELECT id, email, name, image FROM users WHERE id = ?`, [id])) ?? null;
}

/** ADMIN_EMAILS: comma-separated, case-insensitive. Read on every call so a changed env applies after a restart only. */
export function isAdminEmail(email: string | null | undefined, env = process.env.ADMIN_EMAILS): boolean {
  if (!email) return false;
  const admins = (env ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}
