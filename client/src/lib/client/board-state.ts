import type { BoardData, BoardSpecV2, BoardView, HeaderData, StreamMsg, WidgetData } from "@/lib/spec";

export type Partial = {
  stage?: string;
  spec?: BoardSpecV2;
  header?: globalThis.Partial<HeaderData>;
  widgets?: Record<string, WidgetData>;
};

export type BoardState = { board: BoardView; partial: Partial | null };

export type Applied = { state: BoardState; refetch: boolean };

const MAX_EVENTS = 200;

/**
 * Applies one stream message. Pure, so it can be tested without a browser.
 * `refetch` asks the caller to load the whole board again, when a message shows that some were missed.
 */
export function applyMessage(s: BoardState, msg: StreamMsg): Applied {
  const b = s.board;
  switch (msg.type) {
    case "hello":
      return { state: s, refetch: msg.version !== b.version };
    case "status": {
      const done = msg.status === "live" || msg.status === "error";
      return { state: { board: { ...b, status: msg.status, tier: msg.tier }, partial: done ? null : s.partial }, refetch: false };
    }
    case "spec": {
      if (msg.version < b.version) return { state: s, refetch: false };
      if (msg.version > b.version + 1) return { state: s, refetch: true };
      return { state: { board: { ...b, spec: msg.spec, specVersion: 2, version: msg.version }, partial: s.partial }, refetch: false };
    }
    case "data": {
      if (msg.version < b.version) return { state: s, refetch: false };
      if (msg.version > b.version + 1) return { state: s, refetch: true };
      const prev = b.data;
      if (!prev && !msg.header) return { state: s, refetch: true };
      const data: BoardData = {
        header: msg.header ?? (prev as BoardData).header,
        widgets: { ...(prev?.widgets ?? {}), ...msg.widgets },
        hidden: msg.hidden ?? prev?.hidden ?? [],
        generatedAt: Date.now(),
      };
      return { state: { board: { ...b, data, version: msg.version }, partial: null }, refetch: false };
    }
    case "sources": {
      const gone = new Set(msg.discarded);
      const seen = new Set<string>();
      const sources = [...b.sources, ...msg.added].filter((x) => {
        if (gone.has(x.id) || seen.has(x.id)) return false;
        seen.add(x.id);
        return true;
      });
      return { state: { ...s, board: { ...b, sources } }, refetch: false };
    }
    case "event": {
      const events = [msg.event, ...b.events.filter((e) => e.id !== msg.event.id)].slice(0, MAX_EVENTS);
      return { state: { ...s, board: { ...b, events } }, refetch: false };
    }
    case "partial": {
      const p = s.partial ?? {};
      return {
        state: {
          ...s,
          partial: {
            stage: msg.stage ?? p.stage,
            spec: msg.spec ?? p.spec,
            header: msg.header ? { ...p.header, ...msg.header } : p.header,
            widgets: msg.widgets ? { ...p.widgets, ...msg.widgets } : p.widgets,
          },
        },
        refetch: false,
      };
    }
  }
}

/** What the board shows: stored spec and data, with a running build's partial results on top. */
export function visible(s: BoardState): { spec: BoardSpecV2 | null; data: BoardData | null } {
  const { board, partial } = s;
  if (!partial) return { spec: board.spec, data: board.data };
  const spec = partial.spec ?? board.spec;
  const base = board.data;
  const header = partial.header && (base?.header || partial.header.title) ? ({ ...base?.header, ...partial.header } as HeaderData) : base?.header;
  if (!header) return { spec, data: base };
  return {
    spec,
    data: {
      header,
      widgets: { ...(base?.widgets ?? {}), ...(partial.widgets ?? {}) },
      hidden: partial.widgets ? (base?.hidden ?? []).filter((id) => !(id in (partial.widgets ?? {}))) : (base?.hidden ?? []),
      generatedAt: base?.generatedAt ?? Date.now(),
    },
  };
}
