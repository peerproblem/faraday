"use client";

import { useRef, type ComponentProps } from "react";
import { SegmentedControl as SwSegmentedControl, useAgentBinding } from "@sw3/ui";

type Props<V extends string> = ComponentProps<typeof SwSegmentedControl<V>>;

/**
 * The sw3 SegmentedControl, registered with the agent bridge. Like a plain Button, in sw3 v1 it is only
 * found by the bridge's DOM fallback, which skips everything inside Tabs, Accordion or Resizable.
 */
export function SegmentedControl<V extends string>(props: Props<V>) {
  const ref = useRef<HTMLSpanElement>(null);
  useAgentBinding(ref, {
    kind: "segmented-control",
    label: props["aria-label"],
    state: () => ({ value: props.value }),
    items: () => props.options.map((o) => ({ value: o.value, label: typeof o.label === "string" ? o.label : o.value, disabled: o.disabled })),
    actions: {
      setValue: (v: string) => {
        const want = String(v).trim().toLowerCase();
        const hit = props.options.find((o) => o.value.toLowerCase() === want || (typeof o.label === "string" && o.label.toLowerCase() === want));
        if (!hit) throw new Error(`No option "${v}"`);
        props.onValueChange(hit.value);
      },
    },
  });
  return (
    <span ref={ref} className="inline-flex max-w-full">
      <SwSegmentedControl {...props} />
    </span>
  );
}
