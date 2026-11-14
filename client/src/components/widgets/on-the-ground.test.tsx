import "../__tests__/jsdom-stubs";
import "../__tests__/mocks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Source } from "@/lib/spec";
import { feedItems } from "./feed";
import { OnTheGroundWidget } from "./on-the-ground";
import { SourceChips } from "./source-chips";
import type { WidgetProps } from "./types";

const social: Source = { id: "sx", kind: "social", sourceType: "social", url: "https://x.com/local/status/1", title: "@local", publisher: "@local", publishedAt: null, fetchedAt: 0, snippet: "Unconfirmed local report.", relevance: 0.9 };
describe("unverified social reports", () => {
  it("labels reports as unverified and provides their source citation", () => {
    const props: WidgetProps<"on-the-ground"> = {
      widget: { id: "ground", type: "on-the-ground", title: "On the ground (unverified)", span: "full", bind: null, metrics: [] },
      data: { items: [{ id: "r1", quote: social.snippet!, sources: [social.id], asOf: null }] },
      sources: new Map([[social.id, social]]), allSources: [social], events: [], status: "live", tier: "hot", building: false,
    };
    render(<OnTheGroundWidget {...props} />);
    expect(screen.getByText(/Unverified social reports/)).toBeTruthy();
    expect(screen.getByText(social.snippet!)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Source sx/ })).toBeTruthy();
  });
  it("reads a post from another language in English and keeps its own words one press away", async () => {
    const user = userEvent.setup();
    const post: Source = { ...social, snippet: null };
    const original = "La marcha llena la Gran Via.";
    const props: WidgetProps<"on-the-ground"> = {
      widget: { id: "ground", type: "on-the-ground", title: "On the ground (unverified)", span: "full", bind: null, metrics: [] },
      data: { items: [{ id: "r1", quote: "The march fills Gran Via.", sources: [post.id], asOf: null, evidence: { source: post.id, quote: "The march fills Gran Via.", original } }] },
      sources: new Map([[post.id, post]]), allSources: [post], events: [], status: "live", tier: "hot", building: false,
    };
    render(<OnTheGroundWidget {...props} />);
    expect(screen.getByText("The march fills Gran Via.")).toBeTruthy();
    expect(screen.getByText("@local")).toBeTruthy();
    expect(screen.getByText("Translated")).toBeTruthy();
    expect(screen.queryByText(original)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show original" }));
    expect(screen.getByText(original)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide original" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("shows a figure's verified sentence in the preview of the source it was copied from", async () => {
    const user = userEvent.setup();
    const news: Source = { ...social, id: "s1", kind: "news", sourceType: "news", url: "https://dw.com/a", publisher: "DW", title: "Strike", snippet: "A passage of the page that is not the sentence." };
    const other: Source = { ...news, id: "s2", url: "https://elpais.com/b", publisher: null };
    const sources = new Map([[news.id, news], [other.id, other]]);
    const chips = <SourceChips ids={["s1", "s2"]} sources={sources} evidence={{ source: "s1", quote: "At least 115 people were arrested." }} />;
    const first = render(chips);
    await user.click(screen.getByRole("button", { name: /Source s1/ }));
    expect(screen.getByText("Verified in the source")).toBeTruthy();
    expect(screen.getByText("At least 115 people were arrested.")).toBeTruthy();
    expect(screen.queryByText(news.snippet!)).toBeNull();
    first.unmount();
    // The other source only confirms the figure: its preview falls back to a passage of its page.
    render(chips);
    await user.click(screen.getByRole("button", { name: /Source s2/ }));
    expect(screen.queryByText("Verified in the source")).toBeNull();
    expect(screen.getByText(other.snippet!)).toBeTruthy();
  });

  it("excludes social reports from the news feed even when their publisher is mislabeled", () => {
    expect(feedItems([social, { ...social, id: "s2", sourceType: "official" }])).toEqual([]);
  });
});
