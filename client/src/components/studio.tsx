"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Ago } from "@/components/ago";
import { AgentBridge } from "@/components/board/agent-bridge";
import { Board, isBuilding } from "@/components/board/board";
import { BoardToasts, useLiveBoard } from "@/components/board/live-board";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Resizable, ResizableHandle, ResizablePanel } from "@/components/ui/resizable";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Caption, Heading, Text } from "@/components/ui/typography";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState } from "@/components/ui/skeleton";
import { api, boardUrl } from "@/lib/config";
import type { BoardTier, BoardView, RunView, Source, Visibility } from "@/lib/spec";
import { RunWaterfall } from "./studio-run";

async function post(path: string, body?: unknown, method = "POST") {
  const res = await fetch(api(path), {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/** Re-reads the latest run when the pipeline reports progress, and every few seconds while one is running. */
function useLatestRun(boardId: string, trigger: string, building: boolean, initial: RunView | null, enabled: boolean) {
  const [run, setRun] = useState<RunView | null>(initial);
  const load = useCallback(
    () =>
      fetch(api(`/api/boards/${boardId}/runs/latest`), { cache: "no-store", credentials: "include" })
        .then((res) => (res.ok ? (res.json() as Promise<RunView>) : null))
        .catch(() => null),
    [boardId],
  );
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void load().then((v) => {
      if (live && v) setRun(v);
    });
    return () => {
      live = false;
    };
  }, [enabled, load, trigger]);
  const running = building || run?.run?.status === "running";
  useEffect(() => {
    if (!enabled || !running) return;
    const t = setInterval(() => {
      void load().then((v) => v && setRun(v));
    }, 4000);
    return () => clearInterval(t);
  }, [enabled, running, load]);
  return run;
}

export function triageCounts(sources: Source[]) {
  const counts: Record<string, number> = {};
  let untriaged = 0;
  for (const s of sources) {
    if (!s.sourceType) untriaged += 1;
    else counts[s.sourceType] = (counts[s.sourceType] ?? 0) + 1;
  }
  return { counts, untriaged, kept: sources.length - untriaged };
}

const WIDE = "(min-width: 1024px)";

/** True from the first client render on a wide screen. The server and narrow screens get the stacked layout. */
function useWide() {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(WIDE);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

export function Studio({
  initial,
  canEdit,
  initialRun = null,
  offline = false,
}: {
  initial: BoardView;
  canEdit: boolean;
  initialRun?: RunView | null;
  offline?: boolean;
}) {
  const router = useRouter();
  const wide = useWide();
  const { board, partial, spec, data, connected, refresh } = useLiveBoard(initial, { live: !offline });
  const building = isBuilding(board.status);
  const progressKey = board.events.find((e) => e.kind === "stage" || e.kind === "update" || e.kind === "edit" || e.kind === "error")?.id;
  const run = useLatestRun(board.id, `${progressKey ?? ""}:${board.status}`, building, initialRun, !offline);
  const plan = board.plan;

  const side = (
    <aside className="flex min-w-0 flex-col gap-4">
      <Card
        title="Pipeline"
        headingLevel={2}
        actions={
          board.status === "live" ? (
            <Button href={boardUrl(board.slug)} size="xs" variant="ghost">
              Open public board
            </Button>
          ) : undefined
        }
      >
        <RunWaterfall view={run} />
      </Card>

      <Card title="Board studio" headingLevel={2}>
        <Tabs defaultValue="program" size="sm">
          <TabsList aria-label="Studio panels">
            <Tab value="program">Program</Tab>
            <Tab value="plan">Plan</Tab>
            <Tab value="activity">Activity</Tab>
            {canEdit ? <Tab value="manage">Manage</Tab> : null}
          </TabsList>
          <TabsPanel value="program">
            <ProgramPanel board={board} canEdit={canEdit} building={building} />
          </TabsPanel>
          <TabsPanel value="plan">
            {plan ? <PlanPanel board={board} /> : <EmptyState title="No plan yet" description="The plan appears once the topic is planned." />}
          </TabsPanel>
          <TabsPanel value="activity">
            {board.events.length ? (
              <Timeline
                aria-label="Board activity"
                size="sm"
                items={board.events.map((e) => ({
                  value: String(e.id),
                  title: e.message,
                  time: <Ago t={e.ts} />,
                  dateTime: new Date(e.ts).toISOString(),
                  importance: e.kind === "error" ? "high" : "normal",
                }))}
              />
            ) : (
              <EmptyState title="No activity yet" description="Runs, updates and edits are listed here as they happen." />
            )}
          </TabsPanel>
          {canEdit ? (
            <TabsPanel value="manage">
              <ManagePanel board={board} onDeleted={() => router.push("/")} />
            </TabsPanel>
          ) : null}
        </Tabs>
      </Card>
    </aside>
  );

  const main = (
    <Board
      spec={spec}
      data={data}
      specVersion={board.specVersion}
      title={board.title}
      prompt={board.prompt}
      sources={board.sources}
      events={board.events}
      status={board.status}
      tier={board.tier}
      stage={partial?.stage}
      connected={connected}
      lastPolledAt={board.lastPolledAt}
      onRefresh={offline ? undefined : refresh}
    />
  );

  return (
    <div className="pt-2">
      {wide ? (
        // Unframed: the cards inside each panel sit on the page canvas, as everywhere else.
        <Resizable aria-label="Studio layout" framed={false} autoSaveId="faraday-studio" className="items-start">
          <ResizablePanel id="studio-side" defaultSize={34} minSize={24} maxSize={50}>
            <div className="pr-2">{side}</div>
          </ResizablePanel>
          <ResizableHandle aria-label="Resize the studio panels" />
          <ResizablePanel id="studio-board" minSize={50}>
            <div className="pl-2">{main}</div>
          </ResizablePanel>
        </Resizable>
      ) : (
        <div className="flex flex-col gap-4">
          {side}
          {main}
        </div>
      )}
      <BoardToasts />
      <AgentBridge />
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <Heading as="h3" size="sm">
        {title}
      </Heading>
      {children}
    </section>
  );
}

function ProgramPanel({ board, canEdit, building }: { board: BoardView; canEdit: boolean; building: boolean }) {
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function sendEdit() {
    if (sending) return;
    setError(null);
    setSending(true);
    try {
      await post(`/api/boards/${board.id}/edit`, { instruction });
      setInstruction("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-3">
        {board.messages.map((m, i) => (
          <li key={`${m.ts}-${m.role}-${i}`}>
            <div className="flex flex-col gap-1.5">
              <Caption>{m.role === "user" ? "You" : "Faraday"}</Caption>
              <Text size="sm" tone={m.role === "user" ? "default" : "subtle"}>
                {m.content}
              </Text>
            </div>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void sendEdit();
          }}
        >
          <Field label="Edit the program" error={error ?? undefined}>
            <Textarea value={instruction} onValueChange={setInstruction} minRows={2} maxRows={8} placeholder="Add a table of road closures. Focus on the north of the city." />
          </Field>
          <Button
            type="submit"
            variant="accent"
            fullWidth
            loading={sending}
            disabled={instruction.trim().length < 3 || building || board.specVersion < 2}
            data-sw-confirm=""
          >
            Recompile the board
          </Button>
        </form>
      ) : (
        <Text size="sm" tone="muted">
          Only admins can edit the shared board. Everyone can shape their own dashboard.
        </Text>
      )}
    </div>
  );
}

function PlanList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <PanelSection title={title}>
      <ul className="grid gap-1.5">
        {items.map((q, i) => (
          <li key={`${i}-${q}`}>
            <Text size="sm" tone="subtle" className="font-mono">
              {q}
            </Text>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}

function PlanPanel({ board }: { board: BoardView }) {
  const plan = board.plan!;
  const triage = triageCounts(board.sources);
  return (
    <div className="grid gap-5">
      <PanelSection title="Tracked figures">
        <ul className="grid gap-1.5">
          {plan.metrics.map((m) => (
            <li key={m.key}>
              <Text as="span" size="sm">
                {m.label}
              </Text>
              {m.unit ? (
                <Text as="span" size="sm" tone="muted">
                  {" "}
                  ({m.unit})
                </Text>
              ) : null}{" "}
              <Text as="span" size="sm" tone="muted" className="font-mono">
                {m.key}
              </Text>
            </li>
          ))}
        </ul>
      </PanelSection>
      {plan.tables.length ? (
        <PanelSection title="Tracked lists">
          <ul className="grid gap-1.5">
            {plan.tables.map((t) => (
              <li key={t.key}>
                <Text as="span" size="sm">
                  {t.title}
                </Text>
                <Text as="span" size="sm" tone="muted">
                  : {t.columns.map((c) => c.label).join(", ")}
                </Text>
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}
      {plan.statusGroups.length ? <PlanList title="Status groups" items={plan.statusGroups.map((g) => g.title)} /> : null}
      <PanelSection title="Source triage">
        <Text size="sm" tone="subtle">
          {triage.kept} kept
          {Object.entries(triage.counts).length ? `: ${Object.entries(triage.counts).map(([k, n]) => `${n} ${k}`).join(", ")}` : ""}
          {triage.untriaged ? `, ${triage.untriaged} not triaged yet` : ""}
        </Text>
      </PanelSection>
      <PlanList title="Questions the board answers" items={plan.questions.map((q) => q.text)} />
      <PlanList title="News queries" items={plan.newsQueries} />
      <PlanList title="Web queries" items={plan.webQueries} />
      <PanelSection title="Search monitor (every 10 min)">
        <Text size="sm" tone="subtle" className="font-mono">
          {plan.monitor.query}
        </Text>
        <Text size="sm" tone="muted">
          {plan.monitor.instructions}
        </Text>
      </PanelSection>
    </div>
  );
}

const visibilityOptions: { value: Visibility; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "unlisted", label: "Unlisted" },
];

function ManagePanel({ board, onDeleted }: { board: BoardView; onDeleted: () => void }) {
  // What the owner just chose wins until the stream reports a different tier.
  const [chosen, setChosen] = useState<{ base: BoardTier; tier: BoardTier } | null>(null);
  const tier = chosen && chosen.base === board.tier ? chosen.tier : board.tier;
  const setTier = (t: BoardTier) => setChosen({ base: board.tier, tier: t });
  const [visibility, setVisibility] = useState<Visibility>(board.visibility);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const paused = tier === "paused";

  async function togglePause() {
    if (toggling) return;
    setError(null);
    setToggling(true);
    try {
      const r = (await post(`/api/boards/${board.id}/${paused ? "resume" : "pause"}`)) as { tier?: BoardTier };
      setTier(r.tier ?? (paused ? "warm" : "paused"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setToggling(false);
    }
  }

  async function changeVisibility(v: Visibility) {
    const prev = visibility;
    setVisibility(v);
    setError(null);
    try {
      await post(`/api/boards/${board.id}/visibility`, { visibility: v });
    } catch (e) {
      setVisibility(prev);
      setError((e as Error).message);
    }
  }

  async function remove() {
    setError(null);
    try {
      await post(`/api/boards/${board.id}`, undefined, "DELETE");
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }

  return (
    <div className="grid gap-6">
      <PanelSection title="Live updates">
        <Text size="sm" tone="muted">
          {paused ? "Paused. The board keeps what it has but stops reading the web." : "The board reads the web on its own while people are watching."}
        </Text>
        <div>
          <Button variant="outline" size="sm" loading={toggling} onClick={() => void togglePause()}>
            {paused ? "Resume live updates" : "Pause live updates"}
          </Button>
        </div>
      </PanelSection>
      <PanelSection title="Who can find it">
        <div>
          <SegmentedControl aria-label="Board visibility" size="sm" value={visibility} onValueChange={(v) => void changeVisibility(v)} options={visibilityOptions} />
        </div>
        <Text size="sm" tone="muted">
          Unlisted boards work by link but are not shown on the home page.
        </Text>
      </PanelSection>
      <PanelSection title="Delete">
        <div>
          <AlertDialog>
            <AlertDialogTrigger variant="danger" size="sm" data-sw-confirm="">
              Delete board
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this board?</AlertDialogTitle>
                <AlertDialogDescription>
                  {board.title ?? "This board"}, its sources and its web monitors are deleted for everyone. The link stops working.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction variant="danger" onClick={() => remove()} data-sw-confirm="">
                  Delete forever
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </PanelSection>
      {error ? (
        <Text size="sm" className="text-danger" role="alert">
          {error}
        </Text>
      ) : null}
    </div>
  );
}

