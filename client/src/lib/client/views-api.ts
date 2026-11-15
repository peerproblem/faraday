// Browser calls for personal dashboards. The engine reads the session cookie (credentials: "include").
import { api } from "@/lib/config";
import type { BoardCard, BoardLayout, BoardLayoutAssignment, BoardLayoutState, BoardLayoutTemplate, PersonalLayout, TopicCandidateView, TopicRequestView, TopicState, ViewEditResult, ViewSaveResult, Widget } from "@/lib/spec";

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
        ? "Sign in first."
        : res.status === 429
          ? "Too many changes. Try again in a few minutes."
          : `Request failed (${res.status})`;
    throw new ApiError(typeof body.error === "string" ? body.error : fallback, res.status, body);
  }
  return body as T;
}

const path = (boardId: string, rest = "") => `/api/me/views/${encodeURIComponent(boardId)}${rest}`;

export const saveView = (boardId: string, layout: PersonalLayout, rev: number) =>
  call<ViewSaveResult>(path(boardId), { method: "POST", body: { layout, rev }, keepalive: true });

export const editView = (boardId: string, instruction: string) =>
  call<ViewEditResult>(path(boardId, "/edit"), { method: "POST", body: { instruction } });

export const undoView = (boardId: string) => call<ViewSaveResult>(path(boardId, "/undo"), { method: "POST", body: {} });

export const removeView = (boardId: string) => call<{ ok: true }>(path(boardId), { method: "DELETE" });

// Admin. Every admin route answers 403 without an admin session (the fd_admin cookie or an admin Google account).

export const listCandidates = (limit = 50) => call<{ candidates: TopicCandidateView[] }>(`/api/admin/candidates?limit=${limit}`);

export const listRequests = (boardId?: string) =>
  call<{ requests: TopicRequestView[] }>(`/api/admin/requests${boardId ? `?boardId=${encodeURIComponent(boardId)}` : ""}`);

export const adminLogin = (username: string, password: string) =>
  call<{ admin: true }>("/api/admin/login", { method: "POST", body: { username, password } });

export const adminLogout = () => call<{ ok: true }>("/api/admin/logout", { method: "POST", body: {} });

export const adminSession = () => call<{ admin: boolean }>("/api/admin/session");

export const getAdminSettings = () => call<{ discoverEnabled: boolean }>("/api/admin/settings");

export const setAdminSettings = (discoverEnabled: boolean) =>
  call<{ discoverEnabled: boolean }>("/api/admin/settings", { method: "POST", body: { discoverEnabled } });

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
