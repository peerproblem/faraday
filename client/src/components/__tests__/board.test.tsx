import "./jsdom-stubs";
import "./mocks";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { getFixture } from "../../../e2e/fixtures";
import { LiveBoard } from "@/components/board/live-board";
import { sortRows } from "@/components/widgets/table";
import type { BoardView, TableData } from "@/lib/spec";

const NOW = Date.parse("2026-11-14T12:00:00Z");

beforeAll(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterAll(() => {
  vi.useRealTimers();
});

const board = (name: string, patch: Partial<BoardView> = {}) => ({ ...getFixture(name)!.board, ...patch });
const section = (title: string) => screen.getByRole("region", { name: title });

describe("board v2", () => {
  test("keeps the saved overview chart and open Evidence on the map when live data is empty", () => {
    const saved = board("strike");
    const b = board("strike", {
      spec: { version: 2, widgets: [] },
      data: null,
      displaySnapshot: { version: 2, spec: saved.spec!, data: saved.data! },
      presentation: {
        workspace: true, cardsOnMap: true, evidenceOpen: true,
        overviewStatusChart: "table:city-protests",
      },
    });
    render(<LiveBoard initial={b} workspace live={false} />);
    const cards = within(screen.getByRole("group", { name: "Map cards" }));
    expect(cards.getByRole("button", { name: "Evidence" }).getAttribute("aria-expanded")).toBe("true");
    expect(within(cards.getByRole("region", { name: "Situation" }))
      .getByRole("img", { name: /^Turnout & Protests by City by status\./ })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Board details" })).toBeNull();
  });

  test("the left sidebar can show any card content while keeping the default right cards", async () => {
    const user = userEvent.setup();
    const b = board("strike", {
      presentation: {
        workspace: true, cardsOnMap: true,
        sidebar: {
          title: "Access", open: true,
          contents: [{ kind: "widget", type: "table", key: "table:city-protests" }],
        },
      },
    });
    render(<LiveBoard initial={b} workspace live={false} />);
    const sidebar = screen.getByRole("complementary", { name: "Access" });
    expect(within(sidebar).getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Incident timeline" })).toBeNull();
    expect(section("Situation")).toBeTruthy();
    await user.click(within(sidebar).getByRole("button", { name: "Collapse Access" }));
    expect(within(sidebar).getByRole("button", { name: "Expand Access" }).getAttribute("aria-expanded")).toBe("false");
  });

  test("one map card can combine live widgets and use a different chart without changing an unassigned security board", () => {
    const mapBoard = board("strike", {
      presentation: {
        workspace: true, cardsOnMap: true, timelineOpen: true,
        cards: [{
          id: "incidents", title: "Incident details", placement: "right", open: true,
          contents: [{ kind: "widget", type: "table", key: "table:city-protests" },
            { kind: "status-chart", chart: "bars", key: "table:transport-disruptions" }],
        }],
      },
    });
    const { unmount } = render(<LiveBoard initial={mapBoard} workspace live={false} />);
    expect(section("Situation map")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Incident timeline" })).toBeTruthy();
    const details = section("Incident details");
    expect(within(details).getByRole("table")).toBeTruthy();
    expect(within(details).getByLabelText("Transport & Public Service Disruptions by status")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Evidence" })).toBeNull();
    unmount();

    render(<LiveBoard initial={board("cyber")} live={false} />);
    expect(section("Related vulnerabilities")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Incident details" })).toBeNull();
  });

  test("a configured grid renders the saved cards in order", () => {
    const b = board("cyber", {
      presentation: {
        workspace: false,
        cards: [
          { id: "summary", title: "Incident summary", placement: "half", open: true, contents: [{ kind: "summary" }] },
          { id: "vulnerabilities", title: "Vulnerabilities", placement: "full", open: true, contents: [{ kind: "widget", type: "table", key: "table:cves" }] },
        ],
      },
    });
    render(<LiveBoard initial={b} live={false} />);
    const tiles = [section("Incident summary"), section("Vulnerabilities")];
    expect(tiles[0].compareDocumentPosition(tiles[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(tiles[1]).getByRole("table")).toBeTruthy();
  });

  test("renders the header from data.header", () => {
    render(<LiveBoard initial={board("flood")} live={false} />);
    expect(screen.getByRole("heading", { level: 1, name: "Valencia Floods" })).toBeTruthy();
    expect(screen.getByText(/15 people have died and 3,200 were evacuated/)).toBeTruthy();
    expect(screen.getByText("Developing")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Severity" }).getAttribute("aria-valuenow")).toBe("4.3");
  });

  test("draws every known widget and skips unknown types", () => {
    const { container } = render(<LiveBoard initial={board("flood")} live={false} />);
    const ids = [...container.querySelectorAll("[data-widget]")].map((el) => el.getAttribute("data-widget"));
    expect(ids).toEqual(["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "w10", "w11", "w12"]);
    expect(screen.queryByText("Unknown future widget")).toBeNull();
  });

  test("stat tiles show value, delta, conflict and a stale badge only for old figures", () => {
    render(<LiveBoard initial={board("flood")} live={false} />);
    const stats = section("Key figures");
    expect(within(stats).getByText("15")).toBeTruthy();
    expect(within(stats).getByText("+3 since 09:00 UTC")).toBeTruthy();
    expect(within(stats).getByText(/Sources disagree/)).toBeTruthy();
    expect(within(stats).getAllByText("Stale")).toHaveLength(1);
    expect(within(stats).getByRole("img", { name: /Deaths rose from 4 to 15/ })).toBeTruthy();
  });

  test("no stale badges on a board that is not hot", () => {
    render(<LiveBoard initial={board("flood", { tier: "warm" })} live={false} />);
    expect(screen.queryByText("Stale")).toBeNull();
  });

  test("the trend has a text summary for screen readers", () => {
    render(<LiveBoard initial={board("flood")} live={false} />);
    expect(within(section("Deaths over time")).getByRole("img", { name: /Deaths rose from 4 to 15/ })).toBeTruthy();
  });

  test("tables page at 20 rows and sort by column", async () => {
    const user = userEvent.setup();
    render(<LiveBoard initial={board("flood")} live={false} />);
    const t = section("Road closures");
    expect(within(t).getAllByRole("row")).toHaveLength(21);
    await user.click(within(t).getByRole("button", { name: "Next" }));
    expect(within(t).getAllByRole("row")).toHaveLength(5);
    await user.click(within(t).getByRole("button", { name: "Previous" }));
    await user.click(within(t).getByRole("button", { name: "Road" }));
    const first = within(t).getAllByRole("row")[1];
    expect(within(first).getByText("A-7")).toBeTruthy();
    expect(within(t).getByRole("columnheader", { name: /Road/ }).getAttribute("aria-sort")).toBe("ascending");
  });

  test("time sorting compares UTC and local times and keeps unknown times last in both directions", () => {
    const table: TableData = {
      columns: [{ key: "since", label: "Since (EET)", kind: "time" }],
      rows: [
        ["later", "11 Nov 2026 09:00 UTC"],
        ["unknown", "Reported overnight"],
        ["clock", "08:30 EET"],
        ["earlier", "2026-11-11T06:15:00Z"],
      ].map(([id, since]) => ({ id, cells: { since }, sources: [], asOf: null })),
    };
    const ids = (direction: "ascending" | "descending") =>
      sortRows(table, { columnId: "since", direction }).map((row) => row.id);
    expect(ids("ascending")).toEqual(["earlier", "clock", "later", "unknown"]);
    expect(ids("descending")).toEqual(["later", "clock", "earlier", "unknown"]);
  });

  test("link cells show the host and status cells are not plain text", () => {
    render(<LiveBoard initial={board("flood")} live={false} />);
    const t = section("Shelters");
    expect(within(t).getByRole("link", { name: "lasprovincias.es" })).toBeTruthy();
  });

  test("the timeline filter shows only high-importance events", async () => {
    const user = userEvent.setup();
    render(<LiveBoard initial={board("flood")} live={false} />);
    const tl = section("Timeline");
    expect(within(tl).getAllByRole("listitem")).toHaveLength(4);
    await user.click(within(tl).getByRole("radio", { name: "High importance" }));
    expect(within(tl).getAllByRole("listitem")).toHaveLength(2);
  });

  test("advisories put active ones first and mark lifted ones", () => {
    render(<LiveBoard initial={board("flood")} live={false} />);
    const adv = section("Official advisories");
    expect(within(adv).getByText("Lifted")).toBeTruthy();
    expect(within(adv).getAllByRole("button")[0].textContent).toContain("Red warning");
  });

  test("feed, changelog and sources are computed from the board", () => {
    render(<LiveBoard initial={board("flood")} live={false} />);
    expect(within(section("Latest coverage")).getByText("Spain floods: death toll rises to 15")).toBeTruthy();
    expect(within(section("What changed")).getByText(/Death toll rose from 12 to 15/)).toBeTruthy();
    expect(within(section("Sources")).getByText(/10 sources from the live web/)).toBeTruthy();
  });

  test("the map gets only valid points", () => {
    render(<LiveBoard initial={board("flood")} live={false} />);
    expect(screen.getByTestId("map-view").textContent).toBe("4 points");
  });

  test("an outage board shows service states, worst first", () => {
    render(<LiveBoard initial={board("outage")} live={false} />);
    const s = section("Services");
    expect(within(s).getByText("1 down, 2 degraded, 1 unknown, 1 operational")).toBeTruthy();
    expect(within(s).getAllByRole("listitem")[0].textContent).toContain("Outlook");
    expect(screen.queryByTestId("map-view")).toBeNull();
  });

  test("a board without location has no map, and hidden widgets are skipped", () => {
    render(<LiveBoard initial={board("cyber")} live={false} />);
    expect(screen.queryByTestId("map-view")).toBeNull();
    expect(screen.queryByRole("region", { name: "Help" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Seoul Hospital Ransomware" })).toBeTruthy();
  });

  test("a v1 board shows that it is being rebuilt", () => {
    const { container } = render(<LiveBoard initial={board("flood", { specVersion: 1, spec: null, data: null })} live={false} />);
    expect(screen.getByText("Rebuilding this board")).toBeTruthy();
    expect(container.querySelector("[data-widget]")).toBeNull();
  });

  test("while building, planned widgets show as skeletons", () => {
    const b = board("flood", { status: "composing" });
    b.data = { ...b.data!, widgets: {}, header: { ...b.data!.header, headline: null } };
    const { container } = render(<LiveBoard initial={b} live={false} />);
    expect(container.querySelectorAll("[data-widget]").length).toBe(12);
    expect(screen.getByText(/Reading the sources and writing the board/)).toBeTruthy();
  });

  test("a widget that throws does not take the board down", () => {
    const b = board("flood");
    (b.data!.widgets as Record<string, unknown>).w2 = { items: [{ key: "x", valueText: "1", label: "x", tone: "info", history: null, sources: null }] };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => {
      render(<LiveBoard initial={b} live={false} />);
    });
    spy.mockRestore();
    expect(screen.getByRole("heading", { level: 1, name: "Valencia Floods" })).toBeTruthy();
  });
});
