"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Caption, Text } from "@/components/ui/typography";
import { api } from "@/lib/config";

const examples = [
  "Microsoft 365 global outage: Outlook, Teams and Copilot down. What is broken, since when, and is it fixed?",
  "Flood emergency in North Georgia: which roads are closed, where are shelters, and is more rain coming?",
  "Brooklyn building collapse: casualties, rescue progress and what nearby residents should do.",
  "Kyiv blackouts after strikes on the power grid: outage schedules, heating and water status.",
];

const MIN_LENGTH = 8;

export function PromptForm({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const ready = prompt.trim().length >= MIN_LENGTH;

  async function submit() {
    if (!ready || sending) return;
    setError(null);
    if (!signedIn) {
      router.push("/login?next=/");
      return;
    }
    setSending(true);
    try {
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
    } catch {
      setError("Could not reach Faraday. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card padding="md" radius="xl" className="gap-5">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Textarea
          label="Describe the crisis"
          value={prompt}
          onValueChange={setPrompt}
          submitShortcut="mod+enter"
          onSubmitShortcut={() => void submit()}
          minRows={4}
          maxRows={10}
          error={error ?? undefined}
          placeholder="Wildfire near Athens: which areas are evacuating and where are shelters?"
        />
        <Button type="submit" variant="accent" size="lg" fullWidth disabled={!ready} loading={sending}>
          Build the board
        </Button>
        <Text size="sm" tone="muted">
          The sentence is the program. The board is what it compiles to.
        </Text>
      </form>
      <div className="flex flex-col gap-3 border-t border-hairline pt-5">
        <Caption>Or start from an example</Caption>
        <ul className="flex flex-wrap gap-2">
          {examples.map((ex) => (
            <li key={ex} className="min-w-0 max-w-full">
              <Button variant="secondary" size="sm" radius="full" onClick={() => setPrompt(ex)} className="max-w-full">
                <span className="truncate">{ex.split(":")[0]}</span>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
