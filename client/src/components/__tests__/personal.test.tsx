import "./jsdom-stubs";
import "./mocks";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getFixture } from "../../../e2e/fixtures";
import { LiveBoard } from "@/components/board/live-board";
import { AddToDashboard } from "@/components/personal/add-to-dashboard";
import { PersonalBoard } from "@/components/personal/personal-board";
import { transitionLayout } from "@/lib/client/view-transition";
import { SAVE_DEBOUNCE_MS } from "@/lib/client/use-layout";
import { emptyLayout, widgetKeyOf, type BoardView, type PersonalLayout } from "@/lib/spec";

type Call = [string, RequestInit | undefined];
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const board = (): BoardView => getFixture("strike")!.board;
const order = (c: HTMLElement) => [...c.querySelectorAll("[data-widget]")].map((el) => el.getAttribute("data-widget"));
const keyOf = (b: BoardView, id: string) => widgetKeyOf(b.spec!.widgets.find((w) => w.id === id)!);
const posts = (part: string) => (fetchMock.mock.calls as Call[]).filter(([u, i]) => u.includes(part) && i?.method === "POST");

describe("personal dashboard", () => {
  test("draws the baseline with the person's layout: hidden, pinned and resized widgets", () => {
    const b = board();
    const [first, second, third] = b.spec!.widgets;
    const layout: PersonalLayout = { ...emptyLayout(b.version), pinned: [keyOf(b, third.id)], hidden: [keyOf(b, second.id)], size: { [keyOf(b, first.id)]: "half" } };
    const { container } = render(<PersonalBoard initial={b} initialView={{ layout, rev: 2 }} />);
    const ids = order(container);
    expect(ids[0]).toBe(third.id);
    expect(ids).not.toContain(second.id);
    const frame = container.querySelector(`[data-widget="${first.id}"]`)!;
    // A half-width widget spans 6 of the grid's 12 columns. Each tile has its own view-transition-name for the layout animation.
    const tile = frame.closest<HTMLElement>('[data-sw="dashboard-tile"]')!;
    expect(tile.style.gridColumn).toBe("span 6");
    expect(screen.queryByRole("region", { name: "Board workspace" })).toBeNull();
    expect(posts(`/api/me/views/${b.id}`)).toHaveLength(0);
    expect(tile.style.viewTransitionName).toBe(`fd-w-${keyOf(b, first.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`);
  });

  test("preserves existing Map focus panel preferences without saving the personal layout", () => {
    const b = board();
    const key = `sw-app-shell:faraday-map-focus-${b.id}`;
    const saved = JSON.stringify({ sidebar: { open: false, width: 280 }, inspector: { open: true, width: 510 } });
    vi.stubGlobal("localStorage", { getItem: (name: string) => name === key ? saved : null, setItem: vi.fn() });
    render(<PersonalBoard initial={b} initialView={{ layout: { ...emptyLayout(b.version), design: "map-focus" }, rev: 2 }} live={false} />);
    const timeline = screen.getByRole("complementary", { name: "Incident timeline" });
    const map = screen.getByRole("region", { name: "Situation map" });
    expect(within(timeline).getByRole("button", { name: "Expand Timeline" }).getAttribute("aria-expanded")).toBe("false");
    expect(timeline.style.getPropertyValue("--fd-workspace-sidebar-width")).toBe("280px");
    expect(map.style.getPropertyValue("--fd-workspace-details-width")).toBe("510px");
    expect(within(map).getByRole("region", { name: "Situation" })).toBeTruthy();
    expect(posts(`/api/me/views/${b.id}`)).toHaveLength(0);
  });

  test("shows the assigned map layout and preserves table navigation", async () => {
    const user = userEvent.setup();
    const b = board();
    render(<PersonalBoard initial={{ ...b, presentation: { workspace: true, cardsOnMap: true } }}
      initialView={{ layout: { ...emptyLayout(b.version), design: "standard" }, rev: 3 }} live={false} />);
    expect(screen.getByRole("region", { name: "Situation map" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse Timeline" }).getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Collapse Timeline" }));
    expect(screen.getByRole("button", { name: "Expand Timeline" }).getAttribute("aria-expanded")).toBe("false");
    const figures = within(screen.getByRole("list", { name: "Map figures" }));
    expect(figures.getByText("111 trains")).toBeTruthy();
    expect(posts(`/api/me/views/${b.id}`)).toHaveLength(0);
    expect(screen.queryByRole("tabpanel", { name: "Sources" })).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Data" }));
    const selector = screen.getByRole("combobox", { name: "Data section" });
    await user.click(selector);
    await user.click(screen.getByRole("option", { name: "Transport & Public Service Disruptions" }));
    expect(selector.textContent).toContain("Transport & Public Service Disruptions");
    expect(screen.queryByRole("heading", { name: "Transport & Public Service Disruptions" })).toBeNull();
    const table = screen.getByRole("table", { name: /Transport & Public Service Disruptions/ });
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    const pager = screen.getByRole("navigation", { name: "Transport & Public Service Disruptions pages" });
    await user.click(within(pager).getByRole("button", { name: "Next page" }));
    expect(screen.getByText("5–8 of 34 rows")).toBeTruthy();
  });

  test("opens the assigned panels without exposing a template selector to the viewer", async () => {
    const user = userEvent.setup();
    const b = board();
    const presentation = { workspace: true, cardsOnMap: true, timelineOpen: false, evidenceOpen: true };
    render(<PersonalBoard initial={{ ...b, presentation }} initialView={null} live={false} />);
    expect(screen.getByRole("button", { name: "Expand Timeline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Evidence" }).getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Board settings" }));
    expect(screen.queryByRole("combobox", { name: "Dashboard preset" })).toBeNull();
    expect(posts(`/api/me/views/${b.id}`)).toHaveLength(0);
  });

  test("only shows the overview donut on the personal board that chose its table", async () => {
    const user = userEvent.setup();
    const b = board();
    const layout: PersonalLayout = { ...emptyLayout(b.version), design: "map-overlay" };
    fetchMock.mockImplementation(async (_url, init) => json({ layout: JSON.parse(String(init!.body)).layout, rev: 4 }));
    const { unmount } = render(<PersonalBoard initial={b} initialView={{ layout, rev: 3 }} live={false} />);
    const title = "Turnout & Protests by City by status";
    const chart = { name: new RegExp("^Turnout & Protests by City by status\\.") };
    expect(screen.queryByRole("img", chart)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Board settings" }));
    await user.click(screen.getByRole("combobox", { name: "Overview chart" }));
    await user.click(screen.getByRole("option", { name: `${title} (donut)` }));
    expect(within(screen.getByRole("tabpanel", { name: "Overview" })).getByRole("img", chart)).toBeTruthy();
    const path = `/api/me/views/${b.id}`;
    await waitFor(() => expect(posts(path)).toHaveLength(1));
    const saved = JSON.parse(String(posts(path)[0][1]!.body)).layout;
    expect(saved.overviewChart).toEqual({ type: "donut", widget: "table:city-protests" });
    unmount();

    render(<PersonalBoard initial={{ ...b, id: "another-board" }} initialView={{ layout, rev: 1 }} live={false} />);
    expect(screen.queryByRole("img", chart)).toBeNull();
  });

  test("hiding a widget shows at once and saves 300 ms later with the revision it builds on", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchMock.mockImplementation(async (_u, init) => json({ layout: JSON.parse(String(init!.body)).layout, rev: 4 }));
    const b = board();
    const timeline = b.spec!.widgets.find((w) => w.type === "timeline")!;
    const { container } = render(<PersonalBoard initial={b} initialView={{ layout: emptyLayout(b.version), rev: 3 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    fireEvent.click(screen.getByRole("button", { name: `Hide ${timeline.title}` }));
    expect(order(container)).not.toContain(timeline.id);
    expect(posts("/api/me/views/")).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 10);
    });
    const saves = posts(`/api/me/views/${b.id}`);
    expect(saves).toHaveLength(1);
    const body = JSON.parse(String(saves[0][1]!.body)) as { layout: PersonalLayout; rev: number };
    expect(body.rev).toBe(3);
    expect(body.layout.hidden).toContain("timeline");
    // The full order is saved, so widgets the baseline adds later can be told apart.
    expect(body.layout.order.length).toBeGreaterThan(3);
    expect(body.layout.order).not.toContain("timeline");
  });

  test("a 409 shows the layout another tab saved", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const b = board();
    const other: PersonalLayout = { ...emptyLayout(b.version), hidden: ["narrative"] };
    fetchMock.mockImplementation(async () => json({ error: "Changed elsewhere", layout: other, rev: 9 }, 409));
    const narrative = b.spec!.widgets.find((w) => w.type === "narrative")!;
    const { container } = render(<PersonalBoard initial={b} initialView={{ layout: null, rev: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Move .* down$/ })[0]);
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 10);
    });
    await act(async () => {});
    expect(order(container)).not.toContain(narrative.id);
  });

  test("a prompt edit applies the returned layout and says what is not tracked", async () => {
    const b = board();
    const layout: PersonalLayout = { ...emptyLayout(b.version), pinned: ["map"] };
    fetchMock.mockImplementation(async () => json({ layout, rev: 5, reply: "The map is on top now.", unsupported: ["school closures"] }));
    const { container } = render(<PersonalBoard initial={b} initialView={null} />);
    fireEvent.change(screen.getByLabelText("Describe how you want your dashboard"), { target: { value: "Put the map first" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByText(/The map is on top now\./)).toBeTruthy());
    expect(screen.getByText(/request noted: school closures/)).toBeTruthy();
    const map = b.spec!.widgets.find((w) => w.type === "map")!;
    expect(order(container)[0]).toBe(map.id);
    const call = posts("/edit")[0];
    expect(JSON.parse(String(call[1]!.body))).toEqual({ instruction: "Put the map first" });
  });
});

describe("display filters", () => {
  test("a timeline filter keeps only major events", () => {
    const b = board();
    const layout: PersonalLayout = { ...emptyLayout(b.version), filters: { timeline: { kind: "timeline", minImportance: "high" } } };
    render(<PersonalBoard initial={b} initialView={{ layout, rev: 1 }} />);
    const tl = screen.getByRole("region", { name: b.spec!.widgets.find((w) => w.type === "timeline")!.title });
    const items = within(tl).getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((li) => li.getAttribute("data-importance") === "high")).toBe(true);
  });
});

describe("shared board", () => {
  test("offers to add a shared topic and has no layout animation", () => {
    const b = board();
    const { container } = render(
      <LiveBoard initial={b} live={false} actions={<AddToDashboard boardId={b.id} slug={b.slug} version={b.version} signedIn={false} added={false} />} />,
    );
    const link = screen.getByRole("link", { name: "Add to my dashboard" });
    expect(link.getAttribute("href")).toContain("/login?next=");
    const tile = container.querySelector("[data-widget]")!.closest<HTMLElement>('[data-sw="dashboard-tile"]')!;
    expect(tile.style.viewTransitionName).toBe("");
  });

  test("already added opens the personal dashboard", () => {
    const b = board();
    render(<AddToDashboard boardId={b.id} slug={b.slug} version={b.version} signedIn added />);
    expect(screen.getByRole("link", { name: "Open my dashboard" }).getAttribute("href")).toBe(`/me/${b.slug}`);
  });
});

describe("motion", () => {
  test("without View Transitions the change is applied at once", () => {
    const fn = vi.fn();
    transitionLayout(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("with reduced motion the transition is skipped", () => {
    const start = vi.fn();
    (document as unknown as { startViewTransition: unknown }).startViewTransition = start;
    const mm = vi.spyOn(window, "matchMedia").mockImplementation((q) => ({ matches: q.includes("reduce"), media: q }) as MediaQueryList);
    const fn = vi.fn();
    transitionLayout(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    mm.mockRestore();
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });
});
