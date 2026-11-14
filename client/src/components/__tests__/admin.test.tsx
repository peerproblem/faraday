import "./jsdom-stubs";
import "./mocks";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AdminDashboard, AdminLogin } from "@/components/admin/admin-console";
import type { BoardCard } from "@/lib/spec";

type Call = [string, RequestInit | undefined];
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const calls = (part: string, method = "POST") => (fetchMock.mock.calls as Call[]).filter(([u, i]) => u.includes(part) && (i?.method ?? "GET") === method);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const topic = (patch: Partial<BoardCard> = {}): BoardCard => ({
  id: "t1",
  slug: "valencia-floods-ab12c",
  title: "Valencia Floods",
  prompt: "Valencia floods",
  status: "live",
  tier: "hot",
  updatedAt: Date.now(),
  crisisType: "flood",
  severity: 4,
  headline: null,
  accent: "blue",
  origin: "system",
  topicState: "active",
  rankScore: 0.8,
  locationName: "Valencia, Spain",
  ...patch,
});

describe("admin login", () => {
  test("posts the username and password with credentials and shows the error on 401", async () => {
    fetchMock.mockResolvedValue(json({ error: "Wrong username or password" }, 401));
    render(<AdminLogin />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "johnny" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Wrong username or password"));
    const [url, init] = calls("/api/admin/login")[0];
    expect(url).toMatch(/\/api\/admin\/login$/);
    expect(init!.credentials).toBe("include");
    expect(JSON.parse(String(init!.body))).toEqual({ username: "johnny", password: "nope" });
  });
});

describe("admin dashboard", () => {
  test("the discovery switch saves the setting and explains the off state", async () => {
    fetchMock.mockImplementation(async (u) => (String(u).includes("/settings") ? json({ discoverEnabled: true }) : json({ candidates: [], requests: [], topics: [] })));
    render(<AdminDashboard initialDiscover={false} initialTopics={[topic()]} />);
    expect(screen.getByText("Off: only the topics registered here are shown.")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /Discover new topics automatically/ }));
    await waitFor(() => expect(calls("/api/admin/settings")).toHaveLength(1));
    expect(JSON.parse(String(calls("/api/admin/settings")[0][1]!.body))).toEqual({ discoverEnabled: true });
    await waitFor(() => expect(screen.getByRole("switch", { name: /Discover new topics automatically/ }).getAttribute("aria-checked")).toBe("true"));
  });

  test("registering a topic adds it to the list as building", async () => {
    fetchMock.mockImplementation(async (u, init) => {
      const url = String(u);
      if (url.endsWith("/api/admin/topics") && init?.method === "POST") return json({ id: "t2", slug: "kyiv-blackouts-zz9" });
      if (url.endsWith("/api/admin/topics")) return json({ topics: [topic({ id: "t2", slug: "kyiv-blackouts-zz9", title: null, prompt: "Kyiv blackouts after strikes", status: "queued" }), topic()] });
      return json({ candidates: [], requests: [] });
    });
    render(<AdminDashboard initialDiscover={false} initialTopics={[topic()]} />);
    fireEvent.change(screen.getByLabelText("Describe the crisis to follow, in English"), { target: { value: "Kyiv blackouts after strikes" } });
    fireEvent.click(screen.getByRole("button", { name: "Register topic" }));
    await waitFor(() => expect(screen.getByText("Kyiv blackouts after strikes")).toBeTruthy());
    expect(JSON.parse(String(calls("/api/admin/topics")[0][1]!.body))).toEqual({ prompt: "Kyiv blackouts after strikes" });
    expect(screen.getAllByText("Building").length).toBeGreaterThan(0);
  });

  test("archive posts the new state", async () => {
    fetchMock.mockImplementation(async (u) => (String(u).endsWith("/state") ? json({ ok: true }) : json({ topics: [topic({ topicState: "archived" })], candidates: [], requests: [] })));
    render(<AdminDashboard initialDiscover initialTopics={[topic()]} />);
    const list = screen.getByRole("tabpanel");
    fireEvent.click(within(list).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(calls("/api/admin/topics/t1/state")).toHaveLength(1));
    expect(JSON.parse(String(calls("/api/admin/topics/t1/state")[0][1]!.body))).toEqual({ state: "archived" });
    await waitFor(() => expect(within(screen.getByRole("tabpanel")).getByRole("button", { name: "Restore" })).toBeTruthy());
  });
});
