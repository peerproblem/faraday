import "server-only";
import type { AdminSettings, BoardCard, BoardView, RunView, TopicState } from "./spec";
import { API_URL } from "./config";
import { summarizeSources, type TopicSources } from "./source-brand";

// Server-side calls from the web app to the engine. On the Vultr box this goes over
// loopback (ENGINE_URL=http://127.0.0.1:4000); on Vercel it goes to api.<domain>.
const ENGINE = process.env.ENGINE_URL || API_URL;

export type { BoardCard, BoardView };

async function get<T>(path: string, init?: { cookie?: string | null }): Promise<T | null> {
  const res = await fetch(`${ENGINE}${path}`, {
    cache: "no-store",
    headers: init?.cookie ? { cookie: init.cookie } : undefined,
  });
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

/** Shared topics for the home page and /topics, best ranked first. */
export async function listTopics(opts: { state?: TopicState; type?: string | null; limit?: number } = {}): Promise<BoardCard[]> {
  const q = new URLSearchParams({ state: opts.state ?? "active", limit: String(opts.limit ?? 24) });
  if (opts.type) q.set("type", opts.type);
  try {
    return (await get<{ topics: BoardCard[] }>(`/api/topics?${q}`))?.topics ?? [];
  } catch (e) {
    console.error("listTopics failed", e);
    return [];
  }
}

/** Calls that need the admin session: the browser's cookie is forwarded. Null without one or when not found. */
async function getAs<T>(path: string, cookie: string | null): Promise<T | null> {
  if (!cookie) return null;
  const res = await fetch(`${ENGINE}${path}`, { cache: "no-store", headers: { cookie } });
  if (res.status === 401 || res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Engine ${path} answered ${res.status}`);
  return (await res.json()) as T;
}

/** True when the browser's cookies carry an admin session (the admin login or an admin Google account). */
export async function getAdminSession(cookie: string | null): Promise<boolean> {
  try {
    return (await getAs<{ admin: boolean }>("/api/admin/session", cookie))?.admin === true;
  } catch (e) {
    console.error("getAdminSession failed", e);
    return false;
  }
}

/** Admin reads for the first render of /admin. Null when the session is not admin or the engine failed. */
export async function getAdminOverview(cookie: string | null): Promise<{ settings: AdminSettings; topics: BoardCard[] } | null> {
  try {
    const [settings, topics] = await Promise.all([
      getAs<AdminSettings>("/api/admin/settings", cookie),
      getAs<{ topics: BoardCard[] }>("/api/admin/topics", cookie),
    ]);
    if (!settings || !topics) return null;
    return { settings, topics: topics.topics };
  } catch (e) {
    console.error("getAdminOverview failed", e);
    return null;
  }
}

/**
 * Where each topic's board comes from (outlets and newest headlines), for the logos on topic tiles and the home
 * page wire. Interim: it reads every topic's whole board. The engine should send this with the topic cards.
 */
export async function topicSources(topics: Pick<BoardCard, "id" | "title">[], max = 12): Promise<Record<string, TopicSources>> {
  const out: Record<string, TopicSources> = {};
  await Promise.all(
    topics.slice(0, max).map(async (t) => {
      try {
        const v = await get<BoardView>(`/api/boards/${encodeURIComponent(t.id)}`);
        if (v?.sources.length) out[t.id] = summarizeSources(v.sources, t.title);
      } catch (e) {
        console.error("topicSources failed", t.id, e);
      }
    }),
  );
  return out;
}

/** Pass the request cookie to get the admin fields (plan, messages, owner); without an admin session they are empty. */
export const getBoard = (id: string, cookie?: string | null) => get<BoardView>(`/api/boards/${encodeURIComponent(id)}`, { cookie });

export const getBoardBySlug = (slug: string) => get<BoardView>(`/api/boards/by-slug/${encodeURIComponent(slug)}`);

/** Admins only: the engine answers 403 without an admin session, so pass the request cookie. */
export async function getLatestRun(id: string, cookie?: string | null): Promise<RunView | null> {
  try {
    return await get<RunView>(`/api/boards/${encodeURIComponent(id)}/runs/latest`, { cookie });
  } catch {
    return null;
  }
}
