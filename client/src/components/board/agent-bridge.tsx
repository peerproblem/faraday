"use client";

import { useEffect } from "react";
import { createAgent, registerTools, type AllowRequest } from "@/components/ui/agent";

/**
 * Controls that change or delete someone's board carry data-sw-confirm. The bridge refuses an agent's step on
 * them unless this callback says yes, so a person decides.
 */
export function confirmStep(req: Pick<AllowRequest, "label" | "action">, ask: (q: string) => boolean = (q) => window.confirm(q)): boolean {
  return ask(`An agent wants to: ${req.label}. Allow it?`);
}

export function AgentBridge() {
  useEffect(() => {
    const agent = createAgent({ confirm: (req) => confirmStep(req) });
    // Marked controls are confirmed above; everything else on the page is open to the agent.
    return registerTools(agent, { allow: () => true });
  }, []);
  return null;
}
