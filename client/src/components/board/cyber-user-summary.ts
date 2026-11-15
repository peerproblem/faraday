import type { AlertListData, Cited, LinkListData, Source, StatItem, StatusGridData, TableData } from "@/lib/spec";
import type { CyberMetricRole, ResourcePurpose } from "@/lib/spec/cyber";
import { hostOf } from "@/lib/source-brand";
import { toMs } from "@/lib/time";

export function newestReports<T extends { asOf: string | null }>(rows: T[]) {
  return [...rows].sort((a, b) => (toMs(b.asOf) ?? -Infinity) - (toMs(a.asOf) ?? -Infinity));
}

// Compatibility only: older boards have no semantic hints. New hints always take precedence.
export function legacyMetricRole(item: StatItem): CyberMetricRole | undefined {
  const text = `${item.key} ${item.label}`;
  if (/reserve|ratio|price|market.cap/i.test(text)) return "context";
  if (/return|restor|recover/i.test(text)) return "recovery";
  if (/frozen|freez|seiz|contain|replac|reimburs|remediat|notif|patch|fix/i.test(text)) return "response";
  if (/stolen|lost|loss|expos|affect|compromis|breach|disrupt|encrypt/i.test(text)) return "impact";
}

export function recoveryMetrics(metrics: StatItem[]) {
  const figures = newestReports(metrics);
  // Once the generator supplies roles, unclassified additions must not silently fill a role.
  const structured = figures.some(item => item.cyberRole != null);
  return (["impact", "response", "recovery"] as const).map(role => ({
    role,
    item: figures.find(item => (item.cyberRole ?? (structured ? undefined : legacyMetricRole(item))) === role),
  }));
}

export function primaryService(services: StatusGridData["items"]) {
  const current = newestReports(services);
  const overall = current.find(item => item.scope === "overall");
  if (overall) return overall;
  // A newer restored component must not obscure another component's outstanding restriction.
  return current.find(item => item.state === "down" || item.state === "degraded")
    ?? current.find(item => item.state === "unknown") ?? current[0];
}

export type ScopeReport = Cited & { id: string; label: string; status: string; note?: string };

export function scopeReports(tables: TableData[], services: StatusGridData["items"]): ScopeReport[] {
  const structured = tables.some(table => table.cyberRole != null);
  const rows = tables.flatMap(table => {
    if (table.cyberRole === "context" || (structured && table.cyberRole !== "affected-scope")) return [];
    const semantic = table.cyberRole === "affected-scope" || table.columns.some(column => column.cyberRole != null);
    const scopeColumns = table.columns.filter(column => semantic ? column.cyberRole === "subject" : /network|asset|product|version|service|region|customer/i.test(`${column.key} ${column.label}`));
    const statusColumn = table.columns.find(column => semantic ? column.cyberRole === "status" : column.kind === "status");
    const noteColumn = table.columns.find(column => semantic ? column.cyberRole === "note" : /^(notes?|details?)$/i.test(column.key));
    if (!scopeColumns.length || (!semantic && !statusColumn)) return [];
    return table.rows.flatMap(row => {
      const label = scopeColumns.map(column => row.cells[column.key]).filter(Boolean).join(" · ");
      const status = statusColumn ? row.cells[statusColumn.key] : "Scope reported";
      return label ? [{ ...row, label, status: status || "Status not reported", note: noteColumn ? row.cells[noteColumn.key] : undefined }] : [];
    });
  });
  const reports: ScopeReport[] = rows.length ? rows : services.map(service => ({
    ...service,
    label: service.name,
    status: { operational: "Operational", degraded: "Partial disruption", down: "Unavailable", unknown: "Unconfirmed" }[service.state],
  }));
  const seen = new Set<string>();
  return newestReports(reports).filter(report => {
    const key = report.label.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function userAdvisory(advisories: AlertListData["items"], sources: Map<string, Source>) {
  return newestReports(advisories).find(notice => {
    if (!notice.active || !notice.sources.some(id => sources.get(id)?.sourceType === "official")) return false;
    if (notice.audience != null) return notice.audience === "users" || notice.audience === "both";
    const text = notice.title + " " + notice.text;
    const businessOnly = /crypto(?:currency)? (?:firms|businesses)|node operators|service providers|analytics firms/i.test(text);
    return !businessOnly && /account|password|phish|2fa|customers?|users?|patients?|residents?|update|patch|contact|support/i.test(text);
  });
}

export function officialResources(resources: LinkListData["items"]) {
  return resources.filter(item => item.kind === "official" && hostOf(item.url));
}

export function resourceFor(resources: LinkListData["items"], purpose: ResourcePurpose) {
  const official = officialResources(resources);
  const match = official.find(item => item.purpose === purpose);
  if (match) return match;
  const patterns: Partial<Record<ResourcePurpose, RegExp>> = {
    availability: /network|service.*status|availability|status page/i,
    verification: /proof.of.reserves|account.*verif|check.*account/i,
    guidance: /guidance|instructions|patch|support/i,
    updates: /announcements?|incident|update|advisory/i,
  };
  return official.find(item => item.purpose == null && patterns[purpose]?.test(item.label));
}
