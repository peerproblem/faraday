import type { BoardData, BoardView, LinkListData, MapData, Source, TableData, WidgetData } from "./spec";

const releaseTime = "2026-11-11T13:05:00+02:00";
const title = "Suspected territorial violation in the eastern Gulf of Finland";
const governmentUrl = "https://valtioneuvosto.fi/-/236553176/epailty-alueloukkaus-itaisella-suomenlahdella";
const ministryUrl = "https://defmin.fi/-/epailty-alueloukkaus-itaisella-suomenlahdella";
const suspectedEntry = "An unmanned aircraft was suspected of entering Finnish airspace in the eastern Gulf of Finland after 02:00 EET on 11 November. The Ministry of Defence estimated it remained in Finnish airspace for about five minutes.";
const restrictions = "The Finnish Defence Forces introduced temporary aviation and maritime restrictions in the eastern Gulf of Finland after 02:00 EET.";
const investigation = "The Finnish Border Guard was responsible for investigating the suspected violation.";

export const finlandSnapshotCopy = {
  headline: "Finnish authorities reported a suspected airspace violation and temporary restrictions in the eastern Gulf of Finland.",
  prompt: "Saved snapshot of the Finnish Ministry of Defence’s 11 November 2026 announcement about the suspected airspace violation, temporary restrictions and Border Guard investigation.",
};

export function finlandOfficialSnapshot(view: BoardView): BoardView {
  const snapshot = view.displaySnapshot;
  if (!snapshot) return view;
  const { capturedAt } = snapshot;

  // Both URLs carry the same Ministry of Defence release. Preserve the recorded discovery provider when available.
  function release(id: string, url: string, publisher: string): Source {
    const saved = view.sources.find((source) => source.url === url && source.fetchedAt <= capturedAt);
    return {
      id: saved?.id ?? id, url, title, publisher, kind: "web", publishedAt: releaseTime,
      fetchedAt: saved?.fetchedAt ?? capturedAt, snippet: null, relevance: 1,
      sourceType: "official", via: saved?.via ?? null,
    };
  }
  const government = release("official-finland-government", governmentUrl, "Finnish Government");
  const ministry = release("official-finland-defence", ministryUrl, "Finnish Ministry of Defence");
  const governmentCitation = { sources: [government.id], asOf: releaseTime };
  const ministryCitation = { sources: [ministry.id], asOf: releaseTime };
  const widgets: Record<string, WidgetData> = {};
  const hidden: string[] = [];

  for (const widget of snapshot.spec.widgets) {
    const id = widget.id;
    switch (widget.type) {
      case "narrative":
        widgets[id] = { sentences: [
          { text: suspectedEntry, sources: governmentCitation.sources },
          { text: restrictions, sources: ministryCitation.sources },
          { text: investigation, sources: governmentCitation.sources },
        ] };
        break;
      case "stat-grid":
        widgets[id] = { items: [{
          key: "suspected-entry-duration", label: "Estimated time in Finnish airspace", valueText: "About 5",
          valueNum: 5, unit: "min", delta: null, deltaNum: null, tone: "info", conflict: null, history: [],
          ...governmentCitation,
        }] };
        break;
      case "timeline":
        widgets[id] = { items: [
          { id: "official-investigation", at: releaseTime, title: "Border Guard investigation reported", detail: investigation, importance: "medium", ...governmentCitation },
          { id: "official-restrictions", at: "2026-11-11", title: "Temporary restrictions imposed after 02:00 EET", detail: restrictions, importance: "high", ...ministryCitation },
          { id: "official-suspected-violation", at: "2026-11-11", title: "Suspected airspace violation after 02:00 EET", detail: suspectedEntry, importance: "high", ...governmentCitation },
        ] };
        break;
      case "map": {
        const map = snapshot.data.widgets[id] as MapData | undefined;
        const area = map?.points.find(({ name }) => name === "Eastern Gulf of Finland");
        widgets[id] = {
          center: map?.center ?? snapshot.data.header.location,
          points: area ? [{ ...area, ...governmentCitation, evidence: undefined, note: "Approximate region described in the official release." }] : [],
        };
        break;
      }
      case "table": {
        const table = snapshot.data.widgets[id] as TableData | undefined;
        widgets[id] = {
          columns: table?.columns ?? [],
          rows: ["Aviation", "Maritime"].map((domain) => ({
            id: `official-${domain.toLowerCase()}`,
            cells: { domain, status: "Temporary restriction reported", "effective-from": "After 02:00 EET", "lifted-at": "Unspecified", source: "Finnish Ministry of Defence" },
            ...ministryCitation,
          })),
        };
        break;
      }
      case "link-list": {
        const links: LinkListData = { items: [government, ministry].map((source) => ({
          id: `link-${source.id}`, label: `${source.publisher} — ${title}`, url: source.url, kind: "official",
          note: "11 November Ministry of Defence release", sources: [source.id],
        })) };
        widgets[id] = links;
        break;
      }
      case "sources":
        widgets[id] = {};
        break;
      default:
        hidden.push(id);
    }
  }
  const data: BoardData = {
    ...snapshot.data, widgets, hidden,
    header: {
      ...snapshot.data.header,
      subtitle: "Saved snapshot of the 11 November Finnish Ministry of Defence release.",
      headline: { text: finlandSnapshotCopy.headline, sources: [government.id, ministry.id] },
      status: null, statusP: null, severity: null, severityP: null, asOf: releaseTime,
    },
  };
  return { ...view, prompt: finlandSnapshotCopy.prompt, sources: [government, ministry], events: [], data, displaySnapshot: { ...snapshot, data } };
}
