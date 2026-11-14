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
