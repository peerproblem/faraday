// OWNER: F-PIPE-CORE. Deterministic merge (guide P3-7). Model-assisted hints come in from the graph.
import type { Fact, FactDiff, FactKind, PayloadMap, SourceType, StagedFact } from "../spec";
import { numbersEqual } from "./verify";

export type MergeHints = {
  /** `new:<x>` or near-duplicate keys mapped to the canonical key, per kind: { "metric:new:dead": "deaths" }. */
  keyAliases: Record<string, string>;
  /** Index into `incoming` -> id of an existing event fact it duplicates, or -1 - index of an earlier incoming event. */
  eventSameAs: Record<number, number>;
};

export type NewFactRow = {
  kind: FactKind;
  key: string;
  payload: PayloadMap[FactKind];
  valueNum: number | null;
  asOf: string | null;
  sourceIds: string[];
  quote: string | null;
  /** Defaults to active. A fact older than the current value is stored superseded, so trends keep it. */
  status?: "active" | "superseded";
  /** For a superseded row: what replaces it, an existing fact id or an index into `insert`. */
  supersededBy?: { id: number } | { index: number } | null;
};

export type MergeResult = {
  /** Rows to insert as verified (active unless the row says superseded). */
  insert: NewFactRow[];
  /** Existing active facts to mark superseded. `by` is an index into insert. */
  supersede: { id: number; by: number }[];
  /** Existing facts that only gain source ids (same value confirmed by another source); asOf moves forward when given. */
  addSources: { id: number; sourceIds: string[]; asOf?: string | null }[];
  diff: FactDiff;
};

/** Optional context about the sources behind existing facts, used to rank them like incoming ones. */
export type MergeOpts = {
  sourceTypes?: Map<string, SourceType | null>;
  relevance?: Map<string, number | null>;
};

type Ref = { id: number } | { index: number };

/** Two different values for the same metric reported within this window are a conflict. */
export const CONFLICT_WINDOW_MS = 3 * 60 * 60 * 1000;

type Entry = {
  ref: Ref;
  kind: FactKind;
  key: string;
  payload: PayloadMap[FactKind];
  valueNum: number | null;
  asOf: string | null;
  sourceIds: string[];
  status: "active" | "superseded";
  official: boolean;
  social: boolean;
  relevance: number;
  /** Larger is newer: existing facts use createdAt order, staged ones come after all of them. */
  order: number;
};

export const timeOf = (asOf: string | null | undefined): number | null => {
  if (!asOf) return null;
  const t = Date.parse(asOf);
  return Number.isFinite(t) ? t : null;
};
export const dayOf = (asOf: string | null | undefined): string | null => {
  const t = timeOf(asOf);
  return t === null ? null : new Date(t).toISOString().slice(0, 10);
};

export const normTitle = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const normUrl = (u: string) => u.trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

/** One line describing a fact's value, for change logs. */
export function displayValue(kind: FactKind, payload: PayloadMap[FactKind]): string {
  const p = payload as unknown as Record<string, unknown>;
  switch (kind) {
    case "metric":
      return String(p.valueText ?? "");
    case "event":
    case "advisory":
      return String(p.title ?? "") + (kind === "advisory" && p.active === false ? " (lifted)" : "");
    case "place":
      return String(p.name ?? "");
    case "resource":
      return String(p.label ?? "");
    case "row":
      return Object.values((p.cells as Record<string, string>) ?? {}).join(" | ");
    case "status":
      return `${String(p.name ?? "")}: ${String(p.state ?? "")}`;
  }
}

function sameValue(kind: FactKind, a: Entry, b: { payload: PayloadMap[FactKind]; valueNum: number | null }): boolean {
  const pa = a.payload as unknown as Record<string, unknown>;
  const pb = b.payload as unknown as Record<string, unknown>;
  switch (kind) {
    case "metric":
      if (a.valueNum !== null && b.valueNum !== null) return numbersEqual(a.valueNum, b.valueNum);
      return normTitle(String(pa.valueText)) === normTitle(String(pb.valueText));
    case "place":
      return normTitle(String(pa.name)) === normTitle(String(pb.name)) && pa.placeKind === pb.placeKind;
    case "advisory":
      return normTitle(String(pa.title)) === normTitle(String(pb.title)) && pa.level === pb.level && pa.active === pb.active;
    case "resource":
      return normUrl(String(pa.url)) === normUrl(String(pb.url));
    case "row": {
      const ca = (pa.cells as Record<string, string>) ?? {};
      const cb = (pb.cells as Record<string, string>) ?? {};
      const keys = [...new Set([...Object.keys(ca), ...Object.keys(cb)])].sort();
      return keys.every((k) => normTitle(ca[k]) === normTitle(cb[k]));
    }
    case "status":
      return pa.state === pb.state;
    case "event":
      return normTitle(String(pa.title)) === normTitle(String(pb.title));
  }
}

/** Higher wins: newest asOf, then official source, then relevance, then newer row. */
function rankCmp(a: Entry, b: Entry): number {
  const ta = timeOf(a.asOf) ?? -Infinity;
  const tb = timeOf(b.asOf) ?? -Infinity;
  if (ta !== tb) return ta > tb ? 1 : -1;
  if (a.official !== b.official) return a.official ? 1 : -1;
  if (a.relevance !== b.relevance) return a.relevance > b.relevance ? 1 : -1;
  return a.order - b.order;
}

function canonicalKey(kind: FactKind, key: string, aliases: Record<string, string>): string {
  const alias = aliases[`${kind}:${key}`];
  let k = alias ?? key;
  if (k.startsWith("new:")) k = k.slice(4);
  return k;
}

export function mergeFacts(current: Fact[], incoming: StagedFact[], hints: MergeHints, opts: MergeOpts = {}): MergeResult {
  const entries: Entry[] = [];
  const existingById = new Map<number, Entry>();
  const originalKeys = new Set<string>();
  const sortedCurrent = [...current]
    .filter((f) => f.status === "active")
    .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  sortedCurrent.forEach((f, i) => {
    const e: Entry = {
      ref: { id: f.id },
      kind: f.kind,
      key: f.key,
      payload: f.payload,
      valueNum: f.valueNum,
      asOf: f.asOf,
      sourceIds: [...f.sourceIds],
      status: "active",
      social: f.sourceIds.some((s) => opts.sourceTypes?.get(s) === "social") && !f.sourceIds.some((s) => ["official", "news"].includes(opts.sourceTypes?.get(s) ?? "")),
      official: f.sourceIds.some((s) => opts.sourceTypes?.get(s) === "official"),
      relevance: Math.max(0, ...f.sourceIds.map((s) => opts.relevance?.get(s) ?? 0)),
      order: i,
    };
    entries.push(e);
    existingById.set(f.id, e);
    if (!e.social) originalKeys.add(`${f.kind}:${f.key}`);
  });

  const insert: NewFactRow[] = [];
  const supersede: MergeResult["supersede"] = [];
  const addSourcesMap = new Map<number, { ids: Set<string>; asOf: string | null | undefined }>();
  const diff: FactDiff = { added: [], changed: [], superseded: 0 };
  const addedKeys = new Set<string>();
  const changedKeys = new Map<string, number>();
  const incomingEntry = new Map<number, Entry>();

  const confirm = (e: Entry, f: StagedFact) => {
    const fresh = !e.sourceIds.includes(f.sourceId);
    if (fresh) e.sourceIds.push(f.sourceId);
    // An event's asOf is when it happened; a later report of it does not move it.
    const newer = e.kind !== "event" && (timeOf(f.asOf) ?? -Infinity) > (timeOf(e.asOf) ?? -Infinity);
    if (newer) e.asOf = f.asOf;
    if ("index" in e.ref) {
      const row = insert[e.ref.index];
      row.sourceIds = [...e.sourceIds];
      row.asOf = e.asOf;
    } else if (fresh || newer) {
      const a = addSourcesMap.get(e.ref.id) ?? { ids: new Set<string>(), asOf: undefined };
      if (fresh) a.ids.add(f.sourceId);
      if (newer) a.asOf = f.asOf;
      addSourcesMap.set(e.ref.id, a);
    }
    if (f.sourceType === "official") e.official = true;
    e.relevance = Math.max(e.relevance, f.relevance ?? 0);
  };

  const stage = (f: StagedFact, key: string, payload: PayloadMap[FactKind], status: "active" | "superseded", by: Ref | null): Entry => {
    const index = insert.length;
    insert.push({
      kind: f.kind,
      key,
      payload,
      valueNum: f.kind === "metric" ? f.valueNum : null,
      asOf: f.asOf,
      sourceIds: [f.sourceId],
      quote: f.quote,
      status,
      supersededBy: status === "superseded" ? by : null,
    });
    const e: Entry = {
      ref: { index },
      kind: f.kind,
      key,
      payload,
      valueNum: f.kind === "metric" ? f.valueNum : null,
      asOf: f.asOf,
      sourceIds: [f.sourceId],
      status,
      social: f.sourceType === "social",
      official: f.sourceType === "official",
      relevance: f.relevance ?? 0,
      order: sortedCurrent.length + index,
    };
    entries.push(e);
    return e;
  };

  const retire = (e: Entry, by: number) => {
    e.status = "superseded";
    if ("id" in e.ref) {
      supersede.push({ id: e.ref.id, by });
      if (!e.social) diff.superseded += 1;
    } else {
      const row = insert[e.ref.index];
      row.status = "superseded";
      row.supersededBy = { index: by };
    }
  };

  const noteAdded = (kind: FactKind, key: string) => {
    const k = `${kind}:${key}`;
    if (originalKeys.has(k) || addedKeys.has(k)) return;
    addedKeys.add(k);
    diff.added.push({ kind, key });
  };
  const noteChanged = (kind: FactKind, key: string, from: Entry, toPayload: PayloadMap[FactKind]) => {
    if (from.social) return; // Unverified signals never become authoritative change-log figures.
    const k = `${kind}:${key}`;
    if (!originalKeys.has(k)) return;
    const to = displayValue(kind, toPayload);
    const i = changedKeys.get(k);
    if (i !== undefined) {
      diff.changed[i].to = to;
      return;
    }
    changedKeys.set(k, diff.changed.length);
    diff.changed.push({ kind, key, from: displayValue(kind, from.payload), to });
  };

  incoming.forEach((f, i) => {
    const kind = f.kind;
    const key = canonicalKey(kind, f.key, hints.keyAliases);
    let payload = f.payload;

    const sameTrust = (e: Entry) => e.social === (f.sourceType === "social");
    if (kind === "event") {
      let target: Entry | undefined;
      const same = hints.eventSameAs[i];
      if (same !== undefined && same >= 0) target = existingById.get(same);
      else if (same !== undefined && same < 0) target = incomingEntry.get(-1 - same);
      if (target && !sameTrust(target)) target = undefined;
      if (!target) {
        const title = normTitle((f.payload as PayloadMap["event"]).title);
        const day = dayOf(f.asOf);
        target = entries.find((e) => {
          if (e.kind !== "event" || e.status !== "active" || !sameTrust(e)) return false;
          const sameName = e.key === key || normTitle((e.payload as PayloadMap["event"]).title) === title;
          const d = dayOf(e.asOf);
          return sameName && (d === null || day === null || d === day);
        });
      }
      if (target) {
        confirm(target, f);
        incomingEntry.set(i, target);
        return;
      }
      const e = stage(f, key, payload, "active", null);
      incomingEntry.set(i, e);
      if (f.sourceType !== "social" && !originalKeys.has(`event:${key}`)) noteAdded(kind, key);
      return;
    }

    const actives = entries.filter((e) => e.kind === kind && e.key === key && e.status === "active" && sameTrust(e));
    if (!actives.length) {
      incomingEntry.set(i, stage(f, key, payload, "active", null));
      if (f.sourceType !== "social") noteAdded(kind, key);
      return;
    }
    const match = actives.find((e) => sameValue(kind, e, { payload, valueNum: f.valueNum }));
    if (match) {
      confirm(match, f);
      incomingEntry.set(i, match);
      return;
    }
    const cur = [...actives].sort(rankCmp).at(-1)!;
    const tNew = timeOf(f.asOf);
    const tCur = timeOf(cur.asOf);

    if (kind === "place") {
      const pc = cur.payload as PayloadMap["place"];
      const pn = payload as PayloadMap["place"];
      if (pn.lat == null && pc.lat != null && normTitle(pn.name) === normTitle(pc.name)) {
        payload = { ...pn, lat: pc.lat, lon: pc.lon } as PayloadMap["place"];
      }
    }

    if (kind === "metric") {
      const dNew = dayOf(f.asOf);
      const dCur = dayOf(cur.asOf);
      const newer = tNew !== null && (tCur === null || tNew > tCur);
      const older = tNew !== null && tCur !== null && tNew < tCur;
      // Reports far enough apart are an update, not a disagreement. So is a later report from the same source.
      const apart = tNew !== null && tCur !== null && (dNew !== dCur || Math.abs(tNew - tCur) >= CONFLICT_WINDOW_MS);
      const sameSource = cur.sourceIds.includes(f.sourceId);
      if (newer && (tCur === null || apart || sameSource)) {
        // A later day: the new value replaces everything that was active for this key.
        const e = stage(f, key, payload, "active", null);
        const idx = (e.ref as { index: number }).index;
        for (const a of actives) retire(a, idx);
        noteChanged(kind, key, cur, payload);
        incomingEntry.set(i, e);
      } else if (older && (apart || sameSource)) {
        // An older day: keep it for history only.
        incomingEntry.set(i, stage(f, key, payload, "superseded", cur.ref));
      } else if (tNew === null && tCur !== null) {
        // Undated different value next to a dated one: keep it, but it does not change what is shown.
        incomingEntry.set(i, stage(f, key, payload, "active", null));
      } else {
        // Same day (or both undated): a conflict. Both stay active; the assembler shows it.
        const e = stage(f, key, payload, "active", null);
        const winner = [cur, e].sort(rankCmp).at(-1)!;
        if (winner === e) noteChanged(kind, key, cur, payload);
        incomingEntry.set(i, e);
      }
      return;
    }

    // advisory, status, row, place, resource: the newer report replaces the old one.
    if (tNew !== null && tCur !== null && tNew < tCur) {
      incomingEntry.set(i, stage(f, key, payload, "superseded", cur.ref));
      return;
    }
    const e = stage(f, key, payload, "active", null);
    const idx = (e.ref as { index: number }).index;
    for (const a of actives) retire(a, idx);
    noteChanged(kind, key, cur, payload);
    incomingEntry.set(i, e);
  });

  const addSources = [...addSourcesMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, a]) => ({
      id,
      sourceIds: [...a.ids],
      ...(a.asOf !== undefined ? { asOf: a.asOf } : {}),
    }));
  return { insert, supersede, addSources, diff };
}
