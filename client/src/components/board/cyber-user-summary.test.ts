import { describe, expect, it } from "vitest";
import type { AlertListData, Source, StatItem, TableData } from "@/lib/spec";
import { primaryService, recoveryMetrics, resourceFor, scopeReports, userAdvisory } from "./cyber-user-summary";

describe("user-facing cyber reports", () => {
  it("keeps asset/network pairs and planned wording instead of inferring operational status", () => {
    const table: TableData = {
      columns: [{ key: "asset", label: "Asset", kind: "text" }, { key: "network", label: "Network", kind: "text" }, { key: "status", label: "Status", kind: "status" }],
      rows: [{ id: "r1", cells: { asset: "TOKEN", network: "NETWORK", status: "Planned reopening" }, asOf: "2026-11-06", sources: ["s1"] }],
    };
    const [report] = scopeReports([table], []);
    expect(report.label).toBe("TOKEN · NETWORK");
    expect(report.status).toBe("Planned reopening");
    expect(report.asOf).toBe("2026-11-06");
    expect(report.sources).toEqual(["s1"]);
  });

  it("chooses sourced official user advice over a newer business-only alert", () => {
    const sources = new Map([["s1", { sourceType: "official" } as Source]]);
    const common = { issuer: "Authority", level: "warning" as const, url: null, active: true, sources: ["s1"] };
    const notices: AlertListData["items"] = [
      { ...common, id: "business", title: "Action for service providers", text: "Cryptocurrency businesses should block accounts.", asOf: "2026-11-15" },
      { ...common, id: "user", title: "Protect your account", text: "Never share your password.", asOf: null },
    ];
    expect(userAdvisory(notices, sources)?.id).toBe("user");
    expect(userAdvisory(notices, new Map())).toBeUndefined();
  });
});


describe("semantic cyber bindings", () => {
  it("uses declared roles even when keys and labels contain no recognised English keywords", () => {
    const metric = (key: string, cyberRole: StatItem["cyberRole"]) => ({ key, label: key, cyberRole, asOf: null }) as StatItem;
    const slots = recoveryMetrics([metric("alpha", "recovery"), metric("beta", "impact"), metric("gamma", "response"), metric("services-restored", "context")]);
    expect(slots.map(slot => slot.item?.key)).toEqual(["beta", "gamma", "alpha"]);
    expect(recoveryMetrics([metric("alpha", "context"), metric("amount-stolen", undefined)]).every(slot => !slot.item)).toBe(true);
  });

  it("keeps product/version identity without requiring crypto columns or a status column", () => {
    const table: TableData = { cyberRole: "affected-scope", columns: [
      { key: "x", label: "Package", kind: "text", cyberRole: "subject" },
      { key: "y", label: "Build", kind: "text", cyberRole: "subject" },
      { key: "z", label: "Advice", kind: "text", cyberRole: "note" },
    ], rows: ["1.0", "2.0"].map((version, i) => ({ id: `r${i}`, cells: { x: "Example product", y: version, z: "Install the vendor fix" }, sources: ["s1"], asOf: null })) };
    const rows = scopeReports([table], []);
    expect(rows.map(row => row.label)).toEqual(["Example product · 1.0", "Example product · 2.0"]);
    expect(rows[0].status).toBe("Scope reported");
    expect(scopeReports([{ ...table, cyberRole: "context" }], [])).toEqual([]);
  });

  it("uses an explicit overall scope rather than a newer component's status", () => {
    const base = { sources: [], asOf: "2026-11-14", note: "" };
    expect(primaryService([
      { ...base, id: "all", name: "Portal", state: "degraded", scope: "overall" },
      { ...base, id: "one", name: "Feature A", state: "operational", scope: "component", asOf: "2026-11-15" },
    ])?.id).toBe("all");
  });

  it("honours audience and link purpose without matching their wording", () => {
    const sources = new Map([["s1", { sourceType: "official" } as Source]]);
    const notice = { id: "n", title: "Next steps", text: "Use the telephone service.", issuer: "Provider", level: "info" as const, url: null, active: true, asOf: null, sources: ["s1"] };
    expect(userAdvisory([{ ...notice, audience: "users" }], sources)?.id).toBe("n");
    expect(userAdvisory([{ ...notice, audience: "operators", text: "Update user accounts" }], sources)).toBeUndefined();
    const link = { id: "l", label: "Check here", url: "https://example.com/check", kind: "official" as const, purpose: "availability" as const, note: "", sources: ["s1"] };
    expect(resourceFor([link], "availability")).toBe(link);
    expect(resourceFor([{ ...link, label: "Service status", purpose: "other" }], "availability")).toBeUndefined();
  });
});
