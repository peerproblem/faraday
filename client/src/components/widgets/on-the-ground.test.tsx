import "../__tests__/jsdom-stubs";
import "../__tests__/mocks";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Source } from "@/lib/spec";
import { feedItems } from "./feed";
import { OnTheGroundWidget } from "./on-the-ground";
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
  it("excludes social reports from the news feed even when their publisher is mislabeled", () => {
    expect(feedItems([social, { ...social, id: "s2", sourceType: "official" }])).toEqual([]);
  });
});
