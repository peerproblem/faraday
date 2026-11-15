import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Source, StatItem } from "@/lib/spec";
import { CyberIncidentOverview } from "./cyber-incident-overview";

function metric(key: string, label: string, valueText: string, unit: string): StatItem {
  return { key, label, valueText, unit, valueNum: null, delta: null, deltaNum: null, tone: "info",
    conflict: null, history: [], sources: [], asOf: "2026-11-14" };
}

describe("cyber overview topic selection", () => {
  it("shows non-financial impact and recovery together without selecting a view", () => {
    render(<CyberIncidentOverview
      metrics={[metric("facilities-affected", "Facilities affected", "3", "facilities"), metric("services-restored", "Services restored", "2", "services")]}
      services={[{ id: "portal", name: "Patient portal", state: "degraded", note: "Telephone appointments available.", asOf: "2026-11-14", sources: [] }]}
      advisories={[]} sources={new Map()} lastChecked={null} />);
    expect(within(screen.getByRole("region", { name: "Impact" })).getByText("3 facilities")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Recovery" })).getByText("2 services")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Current status" })).getByText("Telephone appointments available.")).toBeTruthy();
    expect(screen.queryByText("Reported stolen")).toBeNull();
  });

  it("keeps overall withdrawal restrictions visible beside newer network-specific restoration", () => {
    render(<CyberIncidentOverview
      metrics={[metric("amount-stolen", "Stolen", "$6 billion", "USD")]}
      services={[
        { id: "all", name: "Example Withdrawals", state: "degraded", note: "Restrictions remain.", asOf: "2026-11-14", sources: [] },
        { id: "part", name: "Withdrawals (87 networks)", state: "operational", note: "87 networks resumed.", asOf: "2026-11-15", sources: [] },
      ]}
      advisories={[]} sources={new Map()} lastChecked={null} />);
    expect(within(screen.getByRole("region", { name: "Current status" })).getByText("Partial disruption")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Current status" })).getByText("Restrictions remain.")).toBeTruthy();
  });

  it("represents absent recovery data as unreported", () => {
    render(<CyberIncidentOverview metrics={[]} services={[]} advisories={[]} sources={new Map()} lastChecked={null} />);
    expect(screen.getByText("Status unconfirmed")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Response" })).getByText("Not reported")).toBeTruthy();
    expect(screen.getByText("Awaiting a dated update")).toBeTruthy();
  });
});


it("renders official destinations as preview chips, reusing real source IDs only for matching URLs", async () => {
  const source = { id: "s8", url: "https://example.com/status", title: "Availability", publisher: "Provider", sourceType: "official", kind: "web", fetchedAt: 0, publishedAt: null, snippet: "Status details", relevance: 1 } as Source;
  render(<CyberIncidentOverview metrics={[]} services={[]} advisories={[]} sources={new Map([[source.id, source]])} lastChecked={null}
    resources={[
      { id: "r1", label: "Availability lookup", url: "https://example.com/status?utm_source=board", kind: "official", purpose: "availability", note: "", sources: ["s8"] },
      { id: "r2", label: "Vendor instructions", url: "https://example.com/help", kind: "official", purpose: "guidance", note: "Read the vendor instructions", sources: ["s8"] },
    ]} />);
  expect(screen.queryByRole("link")).toBeNull();
  const scope = within(screen.getByRole("region", { name: "Affected scope" }));
  expect(scope.getByRole("button", { name: "Source s8: Availability" })).toBeTruthy();
  const guidance = within(screen.getByRole("region", { name: "User guidance" }));
  expect(guidance.queryByRole("button", { name: /Source s8/ })).toBeNull();
  await userEvent.click(guidance.getByRole("button", { name: /Official/ }));
  expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.com/help");
});
