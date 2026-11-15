import type { AlertListData, TableData, TimelineData } from "@/lib/spec";
import { toMs } from "@/lib/time";
import { matchesReportingArea } from "./incident-reports-data";

export const allRegions = { id: "all", label: "Southern Europe", lat: 41.1, lon: 0.8, zoom: 4 };

// Camera reference points for the regional reports in the saved Storm Charles board.
// A reference point locates a region, never a particular incident.
const regionDefinitions = [
  {
    id: "madeira", label: "Madeira & Porto Santo", lat: 32.76, lon: -16.95, zoom: 8,
    areas: ["Madeira", "Porto Santo", "Funchal"], spotlight: "e407",
  },
  {
    id: "portugal", label: "Mainland Portugal", lat: 39.55, lon: -8.05, zoom: 5.8,
    areas: ["mainland Portugal", "Portugal mainland", "Lisbon", "Porto Airport", "Porto Airports", "Faro", "Algarve", "Beira Baixa", "Évora", "Setúbal", "Portalegre"],
    spotlight: "e428",
  },
  {
    id: "spain", label: "Spain", lat: 40.15, lon: -4.4, zoom: 5.3,
    areas: ["Spain", "Spanish", "AEMET", "Cáceres", "Ávila", "Ceuta", "La Palma", "Piedralaves"],
  },
  {
    id: "france", label: "Southern France", lat: 43.45, lon: 5.7, zoom: 6.1,
    areas: ["southern France", "southeastern France", "south east France", "Bouches du Rhône", "Cannes", "Corsica", "Menton", "Alpes Maritimes"],
    spotlight: "e366",
  },
  {
    id: "italy", label: "Italy", lat: 38.7, lon: 15.8, zoom: 5.9,
    areas: ["Italy", "Italian", "Calabria", "Sicily", "Venice"], spotlight: "e365",
  },
  {
    id: "azores", label: "Azores", lat: 37.74, lon: -25.67, zoom: 7,
    areas: ["Azores", "Ponta Delgada"],
  },
];

export type StormNotice = AlertListData["items"][number];
export type StormReport = TableData["rows"][number];
export type StormEvent = TimelineData["items"][number];

function reportRegions(text: string) {
  return regionDefinitions.filter(({ areas }) => matchesReportingArea(text, areas)).map(({ id }) => id);
}

export function stormRecordTime(value: string | null) {
  // A date without an hour only becomes available at the end of that UTC day.
  return toMs(value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
}

type ReplayReport = {
  id: string;
  title: string;
  kind: "impact" | "alert" | "travel";
  regionIds: string[];
  sources: StormEvent["sources"];
  evidence?: StormEvent["evidence"];
  noticeId?: string;
};
type ReplayFrame = { at: string; time: number; reports: ReplayReport[] };

export function stormReplay({ timeline, notices, travel, snapshotAt }: {
  timeline: StormEvent[];
  notices: StormNotice[];
  travel: StormReport[];
  snapshotAt: number;
}) {
  const frames = new Map<number, ReplayFrame>();
  function add(at: string | null, report: ReplayReport) {
    const time = stormRecordTime(at);
    if (!at || time === null || time > snapshotAt) return;
    const frame = frames.get(time) ?? { at, time, reports: [] };
    frame.reports.push(report);
    frames.set(time, frame);
  }
  for (const { id, at, title, detail, sources, evidence } of timeline) {
    add(at, {
      id: `event:${id}`, title, sources, evidence,
      kind: /\b(?:warning|state of alert)\b/i.test(title) ? "alert" : "impact",
      regionIds: reportRegions(`${title} ${detail}`),
    });
  }
  for (const { id, asOf, title, issuer, text, sources, evidence } of notices) {
    add(asOf, {
      id: `notice:${id}`, title, sources, evidence, noticeId: id, kind: "alert",
      regionIds: reportRegions(`${title} ${issuer} ${text}`),
    });
  }
  for (const { id, asOf, cells, sources, evidence } of travel) {
    const { facility, country, status } = cells;
    if (!facility) continue;
    add(asOf, {
      id: `travel:${id}`, title: [facility, status].filter(Boolean).join(" · "), sources, evidence, kind: "travel",
      regionIds: reportRegions(`${facility} ${country ?? ""}`),
    });
  }
  return [...Array.from(frames.values()).sort((a, b) => a.time - b.time), {
    at: new Date(snapshotAt).toISOString(), time: snapshotAt, reports: [],
  }];
}

const severity = { warning: 0, watch: 1, info: 2 };

export function sortStormNotices(items: StormNotice[]) {
  // Explicit end notices come before archived warnings that may have been superseded.
  return [...items].sort((a, b) => Number(a.active) - Number(b.active) ||
    severity[a.level] - severity[b.level] || (toMs(b.asOf) ?? 0) - (toMs(a.asOf) ?? 0));
}

export function stormRegions({ impacts, travel, notices, timeline }: {
  impacts: StormReport[];
  travel: StormReport[];
  notices: StormNotice[];
  timeline: TimelineData["items"];
}) {
  return regionDefinitions.map(({ areas, spotlight, ...region }) => ({
    ...region,
    impacts: impacts.filter(({ cells }) => matchesReportingArea(cells.region ?? "", areas)),
    travel: travel.filter(({ cells }) => matchesReportingArea(`${cells.facility ?? ""} ${cells.country ?? ""}`, areas)),
    notices: notices.filter(({ title, issuer, text }) => matchesReportingArea(`${title} ${issuer} ${text}`, areas)),
    spotlight: timeline.find(({ id }) => id === spotlight),
  })).filter(({ impacts, travel, notices, spotlight }) => impacts.length || travel.length || notices.length || spotlight);
}

export type StormRegion = ReturnType<typeof stormRegions>[number];
