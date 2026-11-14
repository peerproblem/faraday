"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { Field, FieldError, FieldLabel } from "@ui-sdk/react/field";
import { Textarea } from "@ui-sdk/react/textarea";
import { api } from "@/lib/config";

const examples = [
  "Microsoft 365 global outage: Outlook, Teams and Copilot down. What is broken, since when, and is it fixed?",
  "Flood emergency in North Georgia: which roads are closed, where are shelters, and is more rain coming?",
  "Brooklyn building collapse: casualties, rescue progress and what nearby residents should do.",
  "Kyiv blackouts after strikes on the power grid: outage schedules, heating and water status.",
];

export function PromptForm({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!signedIn) {
      router.push("/login?next=/");
      return;
    }
    const res = await fetch(api("/api/boards"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = (await res.json()) as { id?: string; error?: string };
    if (!res.ok || !data.id) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    router.push(`/studio/${data.id}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="rounded-2xl border border-line-strong bg-panel p-3 shadow-[0_20px_60px_rgb(0_0_0/0.35)]"
    >
      <Field invalid={!!error}>
        <FieldLabel className="sr-only">Describe the crisis</FieldLabel>
        <Textarea
          value={prompt}
          onValueChange={(v) => setPrompt(v)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={3}
          placeholder="Describe a crisis and what people need to know. Example: Wildfire near Athens, which areas are evacuating and where are shelters?"
          className="w-full resize-none bg-transparent px-2 py-2 text-base outline-none placeholder:text-faint"
        />
        <FieldError className="px-2 text-sm text-critical">{error}</FieldError>
      </Field>
      <div className="flex flex-wrap items-center gap-2 px-1 pt-2">
        <span className="text-xs text-faint">The sentence is the program. The board is what it compiles to.</span>
        <Button
          type="submit"
          disabled={prompt.trim().length < 8}
          className="ml-auto rounded-lg bg-[#ef4444] px-4 py-2 text-sm font-medium text-white hover:bg-[#dc2626] disabled:opacity-40"
        >
          Build the board
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-line px-1 pt-3">
        {examples.map((ex) => (
          <Button
            key={ex}
            onClick={() => setPrompt(ex)}
            className="max-w-full truncate rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-line-strong hover:text-text"
          >
            {ex.split(":")[0]}
          </Button>
        ))}
      </div>
    </form>
  );
}
