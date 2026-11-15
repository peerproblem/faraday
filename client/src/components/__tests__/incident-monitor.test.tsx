import "./jsdom-stubs";
import "./mocks";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { getFixture } from "../../../e2e/fixtures";
import { LiveBoard } from "@/components/board/live-board";
import { incidentTallyTable, resolveBoardPresentation, type BoardMapRegion, type TableData, type Widget } from "@/lib/spec";

const reportingTable: Widget = {
  id: "tally", type: "table", title: "Official incident totals", span: "half", bind: incidentTallyTable, metrics: [],
};

function tally(region: string, count: number, source = "authority"): TableData["rows"][number] {
  return {
    id: region, asOf: "2026-11-11T23:59:00Z", sources: [source],
    evidence: { source, quote: `${count} incidents` },
    cells: { region, "total-incidents": String(count), "reporting-window-end": "2026-11-11T23:59:00Z" },
  };
}

test.each([
  { name: "Charles", region: "Mainland Portugal", area: "Portugal", alternative: "Madeira", lat: 39.5, lon: -8.0, count: 1857, other: 62 },
  { name: "Finland fixture", region: "Helsinki", area: "Helsinki", alternative: "Espoo", lat: 60.17, lon: 24.94, count: 19, other: 8 },
])("composes the same monitoring cards for $name and refreshes their scoped values", async ({ region, area, alternative, lat, lon, count, other }) => {
  const user = userEvent.setup();
  const baseline = getFixture("strike")!.board;
  const regions: BoardMapRegion[] = [
    { label: region, areas: [area], lat, lon, zoom: 8 },
    { label: alternative, areas: [alternative], lat, lon, zoom: 10 },
  ];
  const settings = resolveBoardPresentation({
    layout: "map", timelineOpen: true, evidenceOpen: false, mapDetails: "aside", mapRegions: regions,
    cards: [{ id: "response", title: "Response", open: true, placement: "right", contents: [
      { kind: "incident-status" }, { kind: "official-tally", chart: "donut" },
    ] }],
  });
  const rows = [tally(region, count), tally(alternative, other), tally(`${alternative} newspaper`, 999, "press")];
  const data = { ...baseline.data!, widgets: { ...baseline.data!.widgets, tally: { columns: [], rows } } };
  let stream: { onmessage: ((event: MessageEvent<string>) => void) | null };
  vi.stubGlobal("EventSource", class extends EventTarget {
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    constructor() { super(); stream = this; }
    close() {}
  });
  try {
    const date = Date.parse("2026-11-15T13:00:00Z");
    vi.spyOn(Date, "now").mockReturnValue(date);
    const { unmount } = render(<LiveBoard workspace initial={{
      ...baseline, presentation: settings, data, spec: { ...baseline.spec!, widgets: [...baseline.spec!.widgets, reportingTable] },
      sources: [...baseline.sources,
        { ...baseline.sources[0], id: "authority", url: "https://agency.example/report", publisher: "Civil Protection", sourceType: "official" },
        { ...baseline.sources[0], id: "press", sourceType: "news" }],
    }} />);
    expect(screen.getByRole("heading", { name: "Action needed now" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Civil Protection official report" }).getAttribute("href")).toBe("https://agency.example/report");
    expect(screen.getByText(new Intl.NumberFormat("en-GB").format(count))).toBeTruthy();
    await user.click(screen.getByText(alternative, { selector: "label, button, span" }));
    expect(screen.queryByText(new Intl.NumberFormat("en-GB").format(count))).toBeNull();
    expect(screen.getByText(String(other), { selector: "strong" })).toBeTruthy();
    expect(screen.queryByText("999")).toBeNull();
    act(() => stream.onmessage!(new MessageEvent("message", { data: JSON.stringify({
      type: "data", version: baseline.version + 1,
      widgets: { tally: { columns: [], rows: [tally(alternative, other + 1)] } },
    }) })));
    expect(await screen.findByText(String(other + 1), { selector: "strong" })).toBeTruthy();
    unmount();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("switches the automatic chart from reported statuses to dated observations after a live update", async () => {
  const baseline = getFixture("strike")!.board;
  const table: Widget = { id: "adaptive-table", key: "table:field-status", type: "table", title: "Field status", bind: "field-status", span: "half", metrics: [] };
  const trend: Widget = { id: "adaptive-trend", key: "trend:water-level", type: "trend", title: "Water level", bind: "water-level", span: "half", metrics: [] };
  const presentation = resolveBoardPresentation({
    layout: "map", timelineOpen: true, evidenceOpen: false, mapDetails: "aside",
    cards: [{ id: "chart", title: "Reports", open: true, placement: "right", contents: [{ kind: "automatic-chart" }] }],
  });
  let stream: { onmessage: ((event: MessageEvent<string>) => void) | null };
  vi.stubGlobal("EventSource", class extends EventTarget {
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    constructor() { super(); stream = this; }
    close() {}
  });
  try {
    const original = baseline.spec!.widgets.filter(({ type }) => type === "map");
    const data = { ...baseline.data!, widgets: {
      ...baseline.data!.widgets,
      [table.id]: {
        columns: [{ key: "status", label: "Status", kind: "status" as const }],
        rows: [{ id: "1", asOf: null, sources: ["s1"], cells: { status: "Closed" } }],
      },
    } };
    render(<LiveBoard workspace initial={{ ...baseline, presentation, data, spec: { ...baseline.spec!, widgets: [...original, table, trend] } }} />);
    expect(screen.getByLabelText("Field status by status")).toBeTruthy();
    const points = [
      { t: "2026-11-11T20:00:00Z", v: 2, sources: ["s1"] },
      { t: "2026-11-11T21:00:00Z", v: 3, sources: ["s1"] },
    ];
    act(() => stream.onmessage!(new MessageEvent("message", { data: JSON.stringify({
      type: "data", version: baseline.version + 1, widgets: {
        [trend.id]: { metric: "water-level", label: "Water level", unit: "m", points },
      },
    }) })));
    expect(await screen.findByRole("region", { name: "Water level" })).toBeTruthy();
    expect(screen.queryByLabelText("Field status by status")).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
