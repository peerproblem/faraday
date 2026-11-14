"use client";

import { useEffect } from "react";
import { createAgent, registerTools, type AllowRequest } from "@/components/ui/agent";

/** Actions that change or delete someone's board. An agent may ask for them, but a person decides. */
export const NEEDS_A_PERSON = ["Recompile the board", "Delete board", "Delete forever"];

/**
 * sw3 v1 lets the agent mark its own step as needing confirmation, but has no way for the app to mark an
 * element. So the app decides here, by the control's name.
 */
export function allowStep(req: Pick<AllowRequest, "label" | "action" | "confirm">, ask: (q: string) => boolean = (q) => window.confirm(q)): boolean {
  const guarded = NEEDS_A_PERSON.some((name) => req.label.trim().toLowerCase() === name.toLowerCase());
  return guarded || req.confirm ? ask(`An agent wants to: ${req.label}. Allow it?`) : true;
}

export function AgentBridge() {
  useEffect(() => {
    const agent = createAgent({ allow: (req) => allowStep(req) });
    // The bridge's allow already asks the person, so WebMCP does not ask a second time.
    return registerTools(agent, { allow: () => true });
  }, []);
  return null;
}
