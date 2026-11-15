// Browser calls for the admin console. The engine reads the admin session cookie (credentials: "include").
import { api } from "@/lib/config";
import type { AdminSettings, BoardCard, BoardLayout, BoardLayoutAssignment, BoardLayoutState, BoardLayoutTemplate, TopicCandidateView, TopicState, Widget } from "@/lib/spec";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
  const res = await fetch(api(path), {
    method: init.method ?? "GET",
    // keepalive lets a save sent while the page is closing finish.
    keepalive: init.keepalive,
    credentials: "include",
    cache: "no-store",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const fallback =
      res.status === 401
        ? "Sign in to /admin first."
        : res.status === 429
          ? "Too many changes. Try again in a few minutes."
          : `Request failed (${res.status})`;
    throw new ApiError(typeof body.error === "string" ? body.error : fallback, res.status, body);
  }
  return body as T;
}

// Admin. Every admin route answers 403 without an admin session (the fd_admin cookie or an admin Google account).

export const listCandidates = (limit = 50) => call<{ candidates: TopicCandidateView[] }>(`/api/admin/candidates?limit=${limit}`);

export const adminLogin = (username: string, password: string) =>
  call<{ admin: true }>("/api/admin/login", { method: "POST", body: { username, password } });

export const adminLogout = () => call<{ ok: true }>("/api/admin/logout", { method: "POST", body: {} });

export const adminSession = () => call<{ admin: boolean }>("/api/admin/session");

export const getAdminSettings = () => call<AdminSettings>("/api/admin/settings");

export const setAdminSettings = (patch: Partial<Pick<AdminSettings, "discoverEnabled" | "distributeLive">>) =>
  call<AdminSettings>("/api/admin/settings", { method: "POST", body: patch });

export const listAdminTopics = () => call<{ topics: BoardCard[] }>("/api/admin/topics");

export const getLayoutLibrary = () =>
  call<{ templates: BoardLayoutTemplate[]; boards: Pick<BoardCard, "id" | "title" | "slug">[] }>("/api/admin/layout-templates");

export const saveLayoutTemplate = (id: string | null, name: string, settings: BoardLayout, rev: number) =>
  call<BoardLayoutTemplate>(id ? `/api/admin/layout-templates/${encodeURIComponent(id)}` : "/api/admin/layout-templates",
    { method: "POST", body: { name, settings, rev } });

const boardLayoutPath = (id: string) => `/api/admin/boards/${encodeURIComponent(id)}/layout`;
export const getAdminBoardLayout = (id: string) =>
  call<BoardLayoutState & { canUseMap: boolean; widgets: Array<Pick<Widget, "type" | "title"> & { key: string; hasStatus?: boolean }> }>(boardLayoutPath(id));
export const saveAdminBoardLayout = (id: string, body: BoardLayoutAssignment & { rev: number }) =>
  call<BoardLayoutState>(boardLayoutPath(id), { method: "POST", body });
export const clearAdminBoardLayout = (id: string, rev: number) =>
  call<BoardLayoutState>(boardLayoutPath(id), { method: "DELETE", body: { rev } });

export const registerTopic = (prompt: string) => call<{ id: string; slug: string }>("/api/admin/topics", { method: "POST", body: { prompt } });

export const setTopicState = (id: string, state: Exclude<TopicState, "merged">) =>
  call<{ ok: true }>(`/api/admin/topics/${encodeURIComponent(id)}/state`, { method: "POST", body: { state } });

export const deleteTopic = (id: string) => call<{ ok?: boolean }>(`/api/boards/${encodeURIComponent(id)}`, { method: "DELETE" });
