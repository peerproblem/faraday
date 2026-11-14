import "./jsdom-stubs";
import "./mocks";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const board = (): BoardView => getFixture("flood")!.board;
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
    expect(frame.className).not.toContain("@4xl:col-span-2");
    // Each widget has its own view-transition-name for the layout animation.
    expect((frame as HTMLElement).style.viewTransitionName).toBe(`fd-w-${keyOf(b, first.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`);
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
    expect(within(tl).queryAllByText("Major").length).toBe(within(tl).getAllByRole("listitem").length);
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
    const frame = container.querySelector("[data-widget]") as HTMLElement;
    expect(frame.style.viewTransitionName).toBe("");
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
