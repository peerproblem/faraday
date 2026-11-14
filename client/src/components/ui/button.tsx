"use client";

import { forwardRef, useRef } from "react";
import { ArrowIcon, Button as SwButton, mergeRefs, useAgentBinding, type ButtonProps } from "@sw3/ui";

export { ArrowIcon };
export type { ButtonProps };

/**
 * The sw3 Button, registered with the agent bridge. In sw3 v1 a plain button is only found by the
 * bridge's DOM fallback, which skips everything inside Tabs, Accordion, Resizable or ScrollArea, so a
 * button in a tab panel is invisible to agents. Registering it here makes it visible anywhere.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const own = useRef<HTMLButtonElement>(null);
  useAgentBinding(own, {
    kind: "button",
    state: () => ({ disabled: own.current?.disabled || undefined }),
    actions: { press: () => own.current?.click() },
  });
  return <SwButton ref={mergeRefs(ref, own)} {...props} />;
});
