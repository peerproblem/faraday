"use client";

import { useRef, useState, useSyncExternalStore, type PointerEvent } from "react";

type SizeKey = "situation" | "evidence";
type Sizes = Partial<Record<SizeKey, number>>;
type Draft = { key: SizeKey; size: number };
type SizeBounds = { min: number; max: number };

const sizeKeys: SizeKey[] = ["situation", "evidence"];
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

export function useWorkspaceSizes(scope: string | undefined) {
  const key = scope ? `faraday:workspace-sizes:v1:${scope}` : null;
  const stored = useSyncExternalStore(subscribe, () => read(key), () => null);
  const [local, setLocal] = useState<Sizes>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const sizes = { ...decode(stored), ...local };

  function handle(sizeKey: SizeKey) {
    return {
      value: draft?.key === sizeKey ? draft.size : sizes[sizeKey],
      onResize: (size: number | null) => setDraft(size === null ? null : { key: sizeKey, size }),
      onCommit: (size: number) => {
        setDraft(null);
        if (key) {
          try {
            window.localStorage.setItem(key, JSON.stringify({ ...decode(read(key)), ...local, [sizeKey]: size }));
            setLocal({});
            window.dispatchEvent(new Event(resizeEvent));
            return;
          } catch {
            // Keep the adjustment usable when browser storage is unavailable.
          }
        }
        setLocal((current) => ({ ...current, [sizeKey]: size }));
      },
    };
  }

  return handle;
}

/** Leave room for the other card's header or its open content. */
export function cardBounds(target: HTMLElement): SizeBounds {
  const stack = target.parentElement;
  if (!stack) return { min: 1, max: target.offsetHeight };

  const peers = Array.from(stack.children).filter((child): child is HTMLElement =>
    child instanceof HTMLElement && child !== target && child.hasAttribute("data-reorder-id"),
  );
  const css = getComputedStyle(stack);
  const inner = stack.clientHeight - (parseFloat(css.paddingTop) || 0) - (parseFloat(css.paddingBottom) || 0);
  const gap = (parseFloat(css.rowGap) || 0) * peers.length;
  const min = Math.max(1, Math.floor(Math.min(144, inner * 0.24)));
  const peerSpace = peers.reduce((height, peer) => height + (
    peer.hasAttribute("data-open") ? min : peer.offsetHeight
  ), 0);

  return { min, max: Math.max(min, target.offsetHeight, Math.floor(inner - gap - peerSpace)) };
}

export type CornerWidth = {
  measure: () => { size: number; bounds: SizeBounds } | null;
  onResize: (size: number | null, startSize: number) => void;
  onCommit: (size: number) => void;
};

type HandleProps = {
  cornerWidth?: CornerWidth;
  target: string;
  label: string;
  edge?: "start" | "end";
  value: number | undefined;
  getBounds: (target: HTMLElement) => SizeBounds;
  onResize: (size: number | null) => void;
  onCommit: (size: number) => void;
};

function constrain(value: number, { min, max }: SizeBounds) {
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function WorkspaceResizeHandle({ target, label, edge = "end", value, getBounds, onResize, onCommit, cornerWidth }: HandleProps) {
  const drag = useRef<{
    id: number;
    start: number;
    startX: number;
    size: number;
    bounds: SizeBounds;
    width?: { size: number; bounds: SizeBounds; moved: boolean };
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const reverse = edge === "start";
  const position = (event: PointerEvent) => reverse ? -event.clientY : event.clientY;

  function measure() {
    const element = document.getElementById(target);
    if (!element) return null;
    return { size: element.offsetHeight, bounds: getBounds(element) };
  }

  function widthAt(current: NonNullable<typeof drag.current>, clientX: number) {
    const width = current.width;
    return width ? constrain(width.size + current.startX - clientX, width.bounds) : null;
  }

  function finish(event: PointerEvent, commit: boolean) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    const size = constrain(current.size + position(event) - current.start, current.bounds);
    if (commit && size !== current.size) onCommit(size);
    else onResize(null);
    if (current.width && cornerWidth) {
      const width = widthAt(current, event.clientX);
      if (commit && width != null && width !== current.width.size) cornerWidth.onCommit(width);
      else if (current.width.moved) cornerWidth.onResize(null, current.width.size);
    }
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={target}
      aria-orientation="horizontal"
      aria-valuetext={value ? `${value} pixels` : "Automatic"}
      title={label}
      className="fd-workspace-resize fd-workspace-resize--height"
      data-edge={edge}
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
          width: width ? { ...width, moved: false } : undefined,
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current?.id === event.pointerId) {
          const size = constrain(current.size + position(event) - current.start, current.bounds);
          onResize(size === current.size ? null : size);
          const width = widthAt(current, event.clientX);
          if (current.width && cornerWidth && width != null) {
            current.width.moved ||= width !== current.width.size;
            if (current.width.moved) cornerWidth.onResize(width, current.width.size);
          }
        }
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
        const backwards = "ArrowUp";
        const forwards = "ArrowDown";
        if (![backwards, forwards, "Home", "End"].includes(event.key)) return;
        const measured = measure();
        if (!measured) return;
        event.preventDefault();
        const { size, bounds } = measured;
        const next = event.key === "Home" ? bounds.min : event.key === "End" ? bounds.max
          : size + (event.key === backwards ? -step : step) * (reverse ? -1 : 1);
        onCommit(constrain(next, bounds));
      }}
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="10" cy="10" r="9" className="fd-workspace-resize-focus" />
        <path d="M14 14l-8-8M10 14l-4-4" />
      </svg>
    </div>
  );
}
