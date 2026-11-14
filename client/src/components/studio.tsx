"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { Field, FieldLabel } from "@ui-sdk/react/field";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { Textarea } from "@ui-sdk/react/textarea";
import { api, boardUrl } from "@/lib/config";
import type { BoardView } from "@/lib/spec";
import { Ago } from "./ago";
import { Board } from "./board/board";
import { AgentBridge, BoardToasts, useLiveBoard } from "./board/live-board";

const pipeline = [
  { key: "planning", stage: "plan", label: "Compile", hint: "Prompt → plan" },
  { key: "gathering", stage: "gather", label: "Read the web", hint: "Context.dev search + news" },
  { key: "composing", stage: "compose", label: "Compose", hint: "Sources → board" },
  { key: "watching", stage: "watch", label: "Watch", hint: "Monitors + polling" },
] as const;

const order = ["queued", "planning", "gathering", "composing", "watching", "live"];

export function Studio({ initial, canEdit }: { initial: BoardView; canEdit: boolean }) {
  const { board, partial, connected, refresh } = useLiveBoard(initial);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const statusIdx = order.indexOf(board.status);
  const plan = board.plan as null | {
    newsQueries?: string[];
    webQueries?: string[];
    monitor?: { query: string; instructions: string };
    questions?: string[];
  };

  async function sendEdit() {
    setError(null);
    const res = await fetch(api(`/api/boards/${board.id}/edit`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? "Edit failed");
      return;
    }
    setInstruction("");
  }

  return (
    <div className="grid gap-4 pt-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        <div className="rounded-xl border border-line bg-panel p-4">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Pipeline</h2>
            {board.status === "live" ? (
              <Link href={boardUrl(board.slug)} className="ml-auto text-xs text-[#ef4444] underline">
                Open public board
              </Link>
            ) : null}
          </div>
          <ol className="mt-3 grid gap-2">
            {pipeline.map((p, i) => {
              const metric = board.metrics?.stages.findLast((s) => s.stage === p.stage);
              const active = board.status === p.key;
              const done = statusIdx > order.indexOf(p.key) || (board.status === "live" && !!metric);
              return (
                <li key={p.key} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[10px] ${
                      done ? "bg-[#ef4444] text-white" : active ? "pulse-dot border border-[#ef4444] text-[#ef4444]" : "border border-line-strong text-faint"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 text-sm">
                      <span className={done || active ? "text-text" : "text-faint"}>{p.label}</span>
                      <span className="text-[11px] text-faint">{p.hint}</span>
                      {metric ? <span className="ml-auto font-mono text-[11px] text-muted">{(metric.ms / 1000).toFixed(1)}s</span> : null}
                    </div>
                    {metric ? <div className="text-xs text-faint">{metric.detail}</div> : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {board.metrics ? (
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
              <Stat label="Context.dev calls" value={board.metrics.contextCalls} />
              <Stat label="LLM calls" value={board.metrics.llmCalls} />
              <Stat label="Sources" value={board.metrics.sourcesRead} />
            </div>
          ) : null}
        </div>

        <Tabs defaultValue="program" className="rounded-xl border border-line bg-panel">
          <TabsList aria-label="Studio panels" className="flex border-b border-line px-2">
            <TabsTab value="program">Program</TabsTab>
            <TabsTab value="plan">Plan</TabsTab>
            <TabsTab value="activity">Activity</TabsTab>
          </TabsList>
          <TabsPanel value="program" className="p-4">
            <ul className="grid gap-3">
              {board.messages.map((m) => (
                <li
                  key={`${m.ts}-${m.role}`}
                  className={`rounded-lg p-3 text-sm ${m.role === "user" ? "bg-panel-2" : "border border-line text-muted"}`}
                >
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-faint">{m.role === "user" ? "You" : "Faraday"}</div>
                  {m.content}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <form
                className="mt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendEdit();
                }}
              >
                <Field>
                  <FieldLabel className="text-xs text-muted">Edit the program</FieldLabel>
                  <Textarea
                    value={instruction}
                    onValueChange={(v) => setInstruction(v)}
                    rows={2}
                    placeholder="Add a table of road closures. Focus on Ellijay."
                    className="mt-1 w-full resize-none rounded-lg border border-line-strong bg-bg p-2 text-sm outline-none focus:border-[#ef4444]"
                  />
                </Field>
                {error ? <p className="mt-1 text-xs text-critical">{error}</p> : null}
                <Button
                  type="submit"
                  disabled={instruction.trim().length < 3 || board.status !== "live"}
                  className="mt-2 w-full rounded-lg bg-[#ef4444] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Recompile the board
                </Button>
              </form>
            ) : (
              <p className="mt-3 text-xs text-faint">Only the person who built this board can edit it.</p>
            )}
          </TabsPanel>
          <TabsPanel value="plan" className="p-4 text-sm">
            {plan ? (
              <div className="grid gap-4">
                <PlanList title="News queries" items={plan.newsQueries} />
                <PlanList title="Web queries" items={plan.webQueries} />
                <PlanList title="Questions the board answers" items={plan.questions} />
                {plan.monitor ? (
                  <div>
                    <h3 className="text-xs font-semibold text-muted">Search monitor (every 10 min)</h3>
                    <p className="mt-1 font-mono text-xs">{plan.monitor.query}</p>
                    <p className="mt-1 text-xs text-faint">{plan.monitor.instructions}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-faint">The plan appears once the prompt is compiled.</p>
            )}
          </TabsPanel>
          <TabsPanel value="activity" className="p-4">
            <ul className="grid gap-1.5 text-xs">
              {board.events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="w-14 shrink-0 font-mono text-faint">
                    <Ago t={e.ts} />
                  </span>
                  <span className={e.kind === "error" ? "text-critical" : e.kind === "update" ? "text-text" : "text-muted"}>
                    {e.message}
                  </span>
                </li>
              ))}
            </ul>
          </TabsPanel>
        </Tabs>
      </aside>

      <div className="min-w-0">
        <Board
          spec={partial ?? board.spec}
          sources={board.sources}
          events={board.events}
          status={board.status}
          connected={connected}
          lastPolledAt={board.lastPolledAt}
          onRefresh={refresh}
        />
      </div>
      <BoardToasts />
      <AgentBridge />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-mono text-lg">{value}</div>
      <div className="text-[10px] text-faint">{label}</div>
    </div>
  );
}

function PlanList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted">{title}</h3>
      <ul className="mt-1 grid gap-1">
        {items.map((q) => (
          <li key={q} className="font-mono text-xs">
            {q}
          </li>
        ))}
      </ul>
    </div>
  );
}
