import "server-only";
import type { BoardStatus, BoardView } from "./spec";
import { API_URL } from "./config";

// Server-side calls from the web app to the engine. On the Vultr box this goes over
// loopback (ENGINE_URL=http://127.0.0.1:4000); on Vercel it goes to api.<domain>.
const ENGINE = process.env.ENGINE_URL || API_URL;

export type BoardCard = {
  id: string;
  slug: string;
  title: string | null;
  prompt: string;
  status: BoardStatus;
  updatedAt: number;
  crisisType: string | null;
  severity: number | null;
  headline: string | null;
  accent: string | null;
};

async function get<T>(path: string): Promise<T | null> {
  const res = await fetch(`${ENGINE}${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Engine ${path} answered ${res.status}`);
  return (await res.json()) as T;
}

export async function listBoards(limit = 24): Promise<BoardCard[]> {
  try {
    return (await get<{ boards: BoardCard[] }>(`/api/boards?limit=${limit}`))?.boards ?? [];
  } catch (e) {
    console.error("listBoards failed", e);
    return [];
  }
}

export const getBoard = (id: string) => get<BoardView>(`/api/boards/${encodeURIComponent(id)}`);

export const getBoardBySlug = (slug: string) => get<BoardView>(`/api/boards/by-slug/${encodeURIComponent(slug)}`);

export async function registerUser(u: { email: string; name: string | null; image: string | null }): Promise<string> {
  const res = await fetch(`${ENGINE}/api/internal/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.INTERNAL_API_KEY ?? ""}` },
    body: JSON.stringify(u),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not register the user (${res.status})`);
  return ((await res.json()) as { id: string }).id;
}
