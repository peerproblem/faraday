import "../__tests__/jsdom-stubs";
import "../__tests__/mocks";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Source, TimelineData } from "@/lib/spec";
import { TimelineWidget } from "./timeline";
import { storyOrder } from "./timeline-story";
import type { WidgetProps } from "./types";

const source: Source = { id: "s1", kind: "news", sourceType: "news", url: "https://www.reuters.com/a", title: "Report", publisher: "Reuters", publishedAt: null, fetchedAt: 0, snippet: null, relevance: 0.9 };
const items: TimelineData["items"] = [
  { id: "e3", at: "2026-11-12T10:00:00Z", title: "Third", detail: "", importance: "high", sources: ["s1"], asOf: null },
  { id: "e1", at: "2026-11-03T00:00:00Z", title: "First", detail: "", importance: "high", sources: ["s1"], asOf: null },
  { id: "e0", at: null, title: "Undated", detail: "", importance: "medium", sources: [], asOf: null },
  { id: "e2", at: "2026-11-05T15:00:00Z", title: "Second", detail: "", importance: "medium", sources: ["s1"], asOf: null },
];

function props(display?: "list" | "story"): WidgetProps<"timeline"> {
  return {
    widget: { id: "w7", type: "timeline", title: "How it unfolded", span: "half", bind: null, metrics: [], ...(display ? { display } : {}) },
    data: { items },
    sources: new Map([[source.id, source]]), allSources: [source], events: [], status: "live", tier: "hot", building: false,
  };
}

const titles = (root: HTMLElement) => within(root).getAllByText(/^(First|Second|Third|Undated)$/).map((el) => el.textContent);

describe("timeline display", () => {
  it("orders a story oldest first, with undated events last", () => {
    expect(storyOrder(items).map((t) => t.id)).toEqual(["e1", "e2", "e3", "e0"]);
  });

  it("keeps the plain list, newest first as given, when no display is set", () => {
    render(<TimelineWidget {...props()} />);
    expect(screen.queryByRole("region", { name: /as a story/ })).toBeNull();
    expect(titles(screen.getByRole("list", { name: "How it unfolded" }))).toEqual(["Third", "First", "Undated", "Second"]);
  });

  it("tells the events as a scrolling story with the first step active", () => {
    render(<TimelineWidget {...props("story")} />);
    const story = screen.getByRole("region", { name: "How it unfolded, as a story" });
    const steps = within(story).getByRole("list");
    expect(titles(steps)).toEqual(["First", "Second", "Third", "Undated"]);
    expect(steps.querySelector("[data-active]")?.textContent).toContain("First");
    expect(story.getAttribute("tabindex")).toBe("0");
  });

  it("filters the story to high-importance events", async () => {
    const user = userEvent.setup();
    render(<TimelineWidget {...props("story")} />);
    await user.click(screen.getByRole("radio", { name: "High importance" }));
    const steps = within(screen.getByRole("region", { name: /as a story/ })).getByRole("list");
    expect(titles(steps)).toEqual(["First", "Third"]);
  });

  it("drops the board's own filter when the personal filter already shows only major events", () => {
    render(<TimelineWidget {...props()} filter={{ kind: "timeline", minImportance: "high" }} />);
    expect(screen.queryByRole("radiogroup", { name: "Filter How it unfolded" })).toBeNull();
    expect(titles(screen.getByRole("list", { name: "How it unfolded" }))).toEqual(["Third", "First"]);
  });

  it("keeps the board's own filter under a Notable personal filter", () => {
    render(<TimelineWidget {...props()} filter={{ kind: "timeline", minImportance: "medium" }} />);
    expect(screen.getByRole("radiogroup", { name: "Filter How it unfolded" })).toBeTruthy();
  });
});
