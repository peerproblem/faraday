"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { flushSync } from "react-dom";

type SizeKey = "timeline" | "details" | "situation" | "evidence";
type Sizes = Partial<Record<SizeKey, number>>;
type AdjacentCard = { key: "situation" | "evidence"; height: number; available: number };
type SizeBounds = { min: number; max: number; adjacent?: AdjacentCard };
type CardSize = { key: AdjacentCard["key"]; height?: number };

const sizeKeys: SizeKey[] = ["timeline", "details", "situation", "evidence"];
const resizeEvent = "faraday-workspace-resize";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(resizeEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(resizeEvent, callback);
  };
}

function read(key: string | null) {
  try {
    return key ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function decode(raw: string | null): Sizes {
  const sizes: Sizes = {};
  if (!raw) return sizes;
  try {
    const parsed = JSON.parse(raw);
    for (const key of sizeKeys) {
      const value = parsed?.[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) sizes[key] = value;
    }
  } catch {
    // Invalid browser preferences fall back to the default flex sizes.
  }
  return sizes;
}

type PanelPreference = { open?: boolean; width?: number };
type LegacyPanels = { sidebar?: PanelPreference; inspector?: PanelPreference };

export function useLegacyWorkspacePanels(scope: string | undefined): LegacyPanels {
  const boardId = scope?.startsWith("personal:") ? scope.slice("personal:".length) : null;
  const key = boardId ? `sw-app-shell:faraday-map-focus-${boardId}` : null;
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  if (!raw) return {};
  try {
    const saved = JSON.parse(raw);
    const panel = (value: PanelPreference | null | undefined): PanelPreference => ({
      open: typeof value?.open === "boolean" ? value.open : undefined,
      width: typeof value?.width === "number" && Number.isFinite(value.width) && value.width > 0 ? value.width : undefined,
    });
    return { sidebar: panel(saved?.sidebar), inspector: panel(saved?.inspector) };
  } catch {
    return {};
  }
}

export function useWorkspaceSizes(scope: string | undefined, fallback: Sizes) {
  const key = scope ? `faraday:workspace-sizes:v1:${scope}` : null;
  const stored = useSyncExternalStore(subscribe, () => read(key), () => null);
  const [local, setLocal] = useState<Sizes>({});
  const [draft, setDraft] = useState<Sizes>({});
  const sizes = { ...fallback, ...decode(stored), ...local };

  function handle(sizeKey: SizeKey) {
    function updateDraft(size: number | null, adjacent?: CardSize) {
      const next = size ?? undefined;
      const adjacentHeight = size == null ? undefined : adjacent?.height;
      setDraft((current) => {
        if (current[sizeKey] === next && (!adjacent || current[adjacent.key] === adjacentHeight)) return current;
        return { ...current, ...(adjacent && { [adjacent.key]: adjacentHeight }), [sizeKey]: next };
      });
    }

    return {
      value: draft[sizeKey] ?? sizes[sizeKey],
      resizing: draft[sizeKey] != null,
      onResize: updateDraft,
      onCommit: (size: number, adjacent?: CardSize) => {
        updateDraft(null, adjacent);
        const next: Sizes = { [sizeKey]: size };
        if (adjacent?.height !== undefined) next[adjacent.key] = adjacent.height;
        if (key) {
          try {
            window.localStorage.setItem(key, JSON.stringify({ ...decode(read(key)), ...local, ...next }));
            setLocal({});
            window.dispatchEvent(new Event(resizeEvent));
            return;
          } catch {
            // Keep the adjustment usable when browser storage is unavailable.
          }
        }
        setLocal((current) => ({ ...current, ...next }));
      },
    };
  }

  return handle;
}

/** The timeline follows the board width so a saved value can be restored on a smaller screen. */
export function timelineBounds(target: HTMLElement): SizeBounds {
  const board = target.parentElement;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const peers = board?.querySelector<HTMLElement>(".fd-workspace-details")?.offsetWidth ?? 0;
  const width = board?.clientWidth ?? target.offsetWidth;
  const min = 12 * rem;
  return { min, max: Math.max(min, Math.min(26.25 * rem, width * 0.32, width - peers - 14 * rem)) };
}

/** Keep the dragged card's starting edge in place and fit the card below it into the remaining height. */
export function cardBounds(target: HTMLElement): SizeBounds {
  const height = target.getBoundingClientRect().height;
  const stack = target.parentElement;
  if (!stack) return { min: 1, max: height };

  const other = Array.from(stack.children).find((child): child is HTMLElement =>
    child instanceof HTMLElement && child !== target && child.hasAttribute("data-reorder-id"),
  );
  const css = getComputedStyle(stack);
  const inner = stack.getBoundingClientRect().height - (parseFloat(css.paddingTop) || 0) - (parseFloat(css.paddingBottom) || 0);
  const min = Math.max(1, Math.min(144, inner * 0.24));
  const available = inner - (other ? parseFloat(css.rowGap) || 0 : 0);
  const key = other?.getAttribute("data-reorder-id");
  const otherHeight = other?.getBoundingClientRect().height ?? 0;
  if (!other?.hasAttribute("data-open") || (key !== "situation" && key !== "evidence")) {
    return { min, max: Math.max(min, height, available - otherHeight) };
  }

  const otherIsAbove = Boolean(other.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
  return {
    min,
    max: Math.max(min, height, available - (otherIsAbove ? otherHeight : min)),
    adjacent: { key, height: otherHeight, available },
  };
}

export type CornerWidth = {
  measure: () => { size: number; bounds: SizeBounds } | null;
  onResize: (size: number | null) => void;
  onCommit: (size: number) => void;
};

type HandleProps = {
  cornerWidth?: CornerWidth;
  target: string;
  label: string;
  axis: "height" | "width";
  value: number | undefined;
  getBounds: (target: HTMLElement) => SizeBounds;
  onResize: (size: number | null, adjacent?: CardSize) => void;
  onCommit: (size: number, adjacent?: CardSize) => void;
};

function constrain(value: number, { min, max }: SizeBounds) {
  return Math.min(max, Math.max(min, value));
}

function fitAdjacent(size: number, { adjacent, min }: SizeBounds): CardSize | undefined {
  if (!adjacent) return undefined;
  const height = Math.max(min, adjacent.available - size);
  return { key: adjacent.key, height: height < adjacent.height ? height : undefined };
}

export function WorkspaceResizeHandle({ target, label, axis, value, getBounds, onResize, onCommit, cornerWidth }: HandleProps) {
  const drag = useRef<{
    id: number;
    start: number;
    startX: number;
    size: number;
    bounds: SizeBounds;
    width?: { size: number; bounds: SizeBounds };
    latest: { position: number; x: number };
    frame: number | null;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => {
    const frame = drag.current?.frame;
    if (frame != null) cancelAnimationFrame(frame);
  }, []);
  const vertical = axis === "height";
  const position = (event: PointerEvent) => vertical ? event.clientY : event.clientX;

  function measure() {
    const element = document.getElementById(target);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { size: vertical ? box.height : box.width, bounds: getBounds(element) };
  }

  function widthAt(current: NonNullable<typeof drag.current>, clientX: number) {
    const width = current.width;
    return width ? constrain(width.size + current.startX - clientX, width.bounds) : null;
  }

  function sizeAt(current: NonNullable<typeof drag.current>, nextPosition: number) {
    return constrain(current.size + nextPosition - current.start, current.bounds);
  }

  function finish(event: PointerEvent, commit: boolean) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    if (current.frame != null) cancelAnimationFrame(current.frame);
    setDragging(false);
    const size = sizeAt(current, position(event));
    const adjacent = fitAdjacent(size, current.bounds);
    if (commit && size !== current.size) onCommit(size, adjacent);
    else onResize(null, adjacent);
    if (current.width && cornerWidth) {
      const width = widthAt(current, event.clientX);
      if (commit && width != null && width !== current.width.size) cornerWidth.onCommit(width);
      else cornerWidth.onResize(null);
    }
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={target}
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-valuetext={value ? `${Math.round(value)} pixels` : "Automatic"}
      title={label}
      className={`fd-workspace-resize fd-workspace-resize--${axis}`}
      data-two-axis={cornerWidth ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || drag.current) return;
        const measured = measure();
        if (!measured) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const width = cornerWidth?.measure();
        drag.current = {
          ...measured, start: position(event), startX: event.clientX, id: event.pointerId,
          width: width ?? undefined,
          latest: { position: position(event), x: event.clientX }, frame: null,
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current?.id !== event.pointerId) return;
        current.latest = { position: position(event), x: event.clientX };
        if (current.frame != null) return;
        current.frame = requestAnimationFrame(() => {
          current.frame = null;
          const size = sizeAt(current, current.latest.position);
          const width = widthAt(current, current.latest.x);
          // Paint both axes together, with the same peer heights that will be saved at drop.
          flushSync(() => {
            onResize(size === current.size ? null : size, fitAdjacent(size, current.bounds));
            if (current.width && cornerWidth && width != null) {
              cornerWidth.onResize(width === current.width.size ? null : width);
            }
          });
        });
      }}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onLostPointerCapture={(event) => finish(event, false)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          const width = cornerWidth?.measure();
          if (cornerWidth && width) {
            event.preventDefault();
            cornerWidth.onCommit(constrain(width.size + (event.key === "ArrowLeft" ? 1 : -1) * step, width.bounds));
            return;
          }
        }
        const backwards = vertical ? "ArrowUp" : "ArrowLeft";
        const forwards = vertical ? "ArrowDown" : "ArrowRight";
        if (![backwards, forwards, "Home", "End"].includes(event.key)) return;
        const measured = measure();
        if (!measured) return;
        event.preventDefault();
        const { size, bounds } = measured;
        const next = event.key === "Home" ? bounds.min : event.key === "End" ? bounds.max
          : size + (event.key === backwards ? -step : step);
        const fitted = constrain(next, bounds);
        if (fitted !== size) onCommit(fitted, fitAdjacent(fitted, bounds));
      }}
    >
      {vertical && <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="10" cy="10" r="9" className="fd-workspace-resize-focus" />
        <path d="M14 14l-8-8M10 14l-4-4" />
      </svg>}
    </div>
  );
}
