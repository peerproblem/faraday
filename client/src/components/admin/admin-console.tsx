"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Ago } from "@/components/ago";
import { boardBadge } from "@/components/board-grid";
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
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Link } from "@/components/ui/link";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, type TableColumn, type TableRow } from "@/components/ui/table";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { OverlayHost, toast } from "@/components/ui/toast";
import { Caption, Heading, Text } from "@/components/ui/typography";
import {
  adminLogin,
  adminLogout,
  deleteTopic,
  listAdminTopics,
  listCandidates,
  listRequests,
  registerTopic,
  setAdminSettings,
  setTopicState,
} from "@/lib/client/views-api";
import { boardUrl } from "@/lib/config";
import type { BoardCard, TopicCandidateView, TopicRequestView } from "@/lib/spec";

const MIN_PROMPT = 8;
const MAX_PROMPT = 1000;

/** Username and password sign-in for the admin console. Independent of the Google sign-in. */
export function AdminLogin() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    if (sending || !username.trim() || !password) return;
    setError(null);
    setSending(true);
    try {
      await adminLogin(username.trim(), password);
      setPassword("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-md pt-8 sm:pt-16">
      <Card padding="lg" radius="xl" className="gap-6">
        <Caption>/admin</Caption>
        <Heading as="h1" size="lg">
          Admin sign-in
        </Heading>
        <Text tone="subtle">For the people who run Faraday&apos;s shared topics.</Text>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input label="Username" name="username" autoComplete="username" value={username} onValueChange={setUsername} />
          <Input label="Password" name="password" type="password" autoComplete="current-password" value={password} onValueChange={setPassword} />
          {error ? (
            <Text size="sm" className="text-danger" role="alert">
              {error}
            </Text>
          ) : null}
          <Button type="submit" variant="accent" size="lg" fullWidth loading={sending} disabled={!username.trim() || !password}>
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}

/** The admin dashboard: discovery switch, topic registration, the topic list, discovery results and requests. */
export function AdminDashboard({ initialDiscover, initialTopics }: { initialDiscover: boolean; initialTopics: BoardCard[] }) {
  const router = useRouter();
  const [discover, setDiscover] = useState(initialDiscover);
  const [savingDiscover, setSavingDiscover] = useState(false);
  const [topics, setTopics] = useState(initialTopics);
  const [signingOut, setSigningOut] = useState(false);

  const reload = useCallback(async () => {
    try {
      setTopics((await listAdminTopics()).topics);
    } catch (e) {
      toast.danger("Could not load the topics", { description: (e as Error).message });
    }
  }, []);

  // New topics build in the background: refresh the list while any of them is still building.
  const building = topics.some((t) => t.status !== "live" && t.status !== "error");
  useEffect(() => {
    if (!building) return;
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [building, reload]);

  async function toggleDiscover(on: boolean) {
    const prev = discover;
    setDiscover(on);
    setSavingDiscover(true);
    try {
      setDiscover((await setAdminSettings(on)).discoverEnabled);
    } catch (e) {
      setDiscover(prev);
      toast.danger("Could not change the setting", { description: (e as Error).message });
    } finally {
      setSavingDiscover(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await adminLogout();
    } catch {
      // The session cookie may already be gone; the page shows the sign-in either way.
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6 pt-8">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-3">
          <Caption>/admin</Caption>
          <Heading as="h1" size="lg">
            Admin
          </Heading>
        </div>
        <div className="ml-auto">
          <Button variant="outline" size="sm" loading={signingOut} onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding="md" className="gap-3">
          <Heading as="h2" size="sm">
            Discovery
          </Heading>
          <Switch
            label="Discover new topics automatically"
            checked={discover}
            disabled={savingDiscover}
            onCheckedChange={(on) => void toggleDiscover(on)}
            description={
              discover
                ? "Faraday scans the news every half hour and opens topics for crises it confirms."
                : "Off: only the topics registered here are shown."
            }
          />
        </Card>
        <RegisterTopic
          onCreated={(t) => {
            setTopics((prev) => [t, ...prev.filter((x) => x.id !== t.id)]);
            void reload();
          }}
        />
      </div>

      <Card padding="md">
        <Tabs defaultValue="topics" size="sm">
          <TabsList aria-label="Admin panels">
            <Tab value="topics">Topics</Tab>
            <Tab value="discovery">Discovery results</Tab>
            <Tab value="requests">Requests</Tab>
          </TabsList>
          <TabsPanel value="topics">
            <TopicList topics={topics} onChanged={reload} onRemoved={(id) => setTopics((prev) => prev.filter((t) => t.id !== id))} />
          </TabsPanel>
          <TabsPanel value="discovery">
            <DiscoveryPanel />
          </TabsPanel>
          <TabsPanel value="requests">
            <RequestsPanel topics={topics} />
          </TabsPanel>
        </Tabs>
      </Card>
      <OverlayHost />
    </div>
  );
}

function RegisterTopic({ onCreated }: { onCreated: (t: BoardCard) => void }) {
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const ready = prompt.trim().length >= MIN_PROMPT;

  async function submit() {
    if (!ready || sending) return;
    setError(null);
    setSending(true);
    try {
      const r = await registerTopic(prompt.trim());
      const now = Date.now();
      onCreated({
        id: r.id,
        slug: r.slug,
        title: null,
        prompt: prompt.trim(),
        status: "queued",
        tier: "hot",
        updatedAt: now,
        crisisType: null,
        severity: null,
        headline: null,
        accent: null,
        origin: "system",
        topicState: "active",
        rankScore: null,
        locationName: null,
      });
      setPrompt("");
      toast("Topic registered", { description: "Its board is being built." });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card padding="md" className="gap-3">
      <Heading as="h2" size="sm">
        Register a topic
      </Heading>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Describe the crisis to follow, in English" error={error ?? undefined}>
          <Textarea
            value={prompt}
            onValueChange={(v) => setPrompt(v.slice(0, MAX_PROMPT))}
            minRows={2}
            maxRows={6}
            placeholder="Flooding in Valencia, Spain: casualties, evacuations, road closures and shelters."
          />
        </Field>
        <div>
          <Button type="submit" variant="accent" size="sm" loading={sending} disabled={!ready}>
            Register topic
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TopicList({ topics, onChanged, onRemoved }: { topics: BoardCard[]; onChanged: () => Promise<void>; onRemoved: (id: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!topics.length) return <EmptyState title="No topics yet" description="Register one above, or turn discovery on." />;

  async function changeState(t: BoardCard, state: "active" | "archived") {
    setBusy(t.id);
    try {
      await setTopicState(t.id, state);
      await onChanged();
    } catch (e) {
      toast.danger("Could not change the topic", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove(t: BoardCard) {
    try {
      await deleteTopic(t.id);
      onRemoved(t.id);
    } catch (e) {
      toast.danger("Could not delete the topic", { description: (e as Error).message });
      throw e;
    }
  }

  const rows: TableRow[] = topics.map((t) => {
    const s = boardBadge(t);
    const archived = t.topicState === "archived";
    const name = t.title ?? t.prompt;
    return {
      id: t.id,
      cells: {
        topic: <span className="font-medium">{name}</span>,
        status: (
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={s.tone} pulse={s.live}>
              {s.text}
            </Badge>
            <Badge variant={archived ? "outline" : "neutral"} mono>
              {archived ? "archived" : (t.topicState ?? "active")}
            </Badge>
            {t.crisisType ? (
              <Badge variant="neutral" mono>
                {t.crisisType}
              </Badge>
            ) : null}
          </span>
        ),
        updated: <Ago t={t.updatedAt} />,
        links: (
          <span className="flex flex-wrap items-center gap-3 whitespace-nowrap">
            <Link href={boardUrl(t.slug)} aria-label={`Board of ${name}`}>
              Board
            </Link>
            <Link href={`/studio/${t.id}`} aria-label={`Studio of ${name}`}>
              Studio
            </Link>
          </span>
        ),
        actions: (
          <span className="flex flex-nowrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" loading={busy === t.id} onClick={() => void changeState(t, archived ? "active" : "archived")}>
              {archived ? "Restore" : "Archive"}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger variant="danger" size="sm" data-sw-confirm="">
                Delete
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this topic?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t.title ?? "This topic"}, its sources, its monitors and everyone&apos;s dashboards of it are deleted. The link stops working.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction variant="danger" data-sw-confirm="" onClick={() => remove(t)}>
                    Delete forever
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </span>
        ),
      },
    };
  });

  const byId = new Map(topics.map((t) => [t.id, t]));
  const of = (r: TableRow) => byId.get(r.id)!;
  const columns: TableColumn[] = [
    { id: "topic", label: "Topic", rowHeader: true, compare: (a, b) => (of(a).title ?? of(a).prompt).localeCompare(of(b).title ?? of(b).prompt) },
    { id: "status", label: "Status" },
    { id: "updated", label: "Updated", compare: (a, b) => of(a).updatedAt - of(b).updatedAt },
    { id: "links", label: "Open" },
    { id: "actions", label: "Actions", align: "end" },
  ];

  return <Table caption="Topics" columns={columns} rows={rows} />;
}

/** Loads once when mounted. Null while loading, an Error when it failed. */
function useLoad<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T | Error | null>(null);
  useEffect(() => {
    let live = true;
    load().then(
      (v) => {
        if (live) setValue(v);
      },
      (e: Error) => {
        if (live) setValue(e);
      },
    );
    return () => {
      live = false;
    };
  }, [load]);
  return value;
}

function Loaded<T>({ label, value, children }: { label: string; value: T | Error | null; children: (v: T) => ReactNode }) {
  const loading = value === null;
  return (
    <div className="flex flex-col gap-3">
      <Text as="span" size="sm" tone="muted" role="status" className="sr-only">
        {loading ? `Loading ${label}…` : `${label} loaded.`}
      </Text>
      <div aria-busy={loading} className="flex flex-col gap-3">
        {loading ? (
          <>
            <Skeleton height={20} width="60%" />
            <Skeleton height={20} />
            <Skeleton height={20} width="80%" />
          </>
        ) : value instanceof Error ? (
          <Text size="sm" className="text-danger" role="alert">
            {value.message}
          </Text>
        ) : (
          children(value)
        )}
      </div>
    </div>
  );
}

const decisionVariant: Record<TopicCandidateView["decision"], BadgeVariant> = {
  created: "success",
  matched: "accent",
  rejected: "neutral",
  deferred: "warning",
};

const loadCandidates = () => listCandidates(50);

function DiscoveryPanel() {
  const r = useLoad(loadCandidates);
  return (
    <Loaded label="Discovery results" value={r}>
      {({ candidates }) => {
        if (!candidates.length)
          return <EmptyState title="No discovery results yet" description="They appear after the scheduler runs with discovery on." />;
        const byId = new Map(candidates.map((c) => [String(c.id), c]));
        const of = (row: TableRow) => byId.get(row.id)!;
        const columns: TableColumn[] = [
          { id: "event", label: "Event", rowHeader: true },
          { id: "decision", label: "Decision", compare: (a, b) => of(a).decision.localeCompare(of(b).decision) },
          { id: "score", label: "Score", align: "end", compare: (a, b) => of(a).score - of(b).score },
          { id: "seen", label: "Seen", compare: (a, b) => of(a).createdAt - of(b).createdAt },
          { id: "topic", label: "Topic" },
        ];
        const rows: TableRow[] = candidates.map((c) => ({
          id: String(c.id),
          cells: {
            event: (
              <span className="flex flex-col gap-1">
                <span className="font-medium">{c.title}</span>
                <Text as="span" size="sm" tone="muted">
                  {[c.crisisType, c.locationName, c.reason].filter(Boolean).join(". ")}
                </Text>
              </span>
            ),
            decision: (
              <Badge variant={decisionVariant[c.decision] ?? "neutral"} mono>
                {c.decision}
              </Badge>
            ),
            score: c.score.toFixed(2),
            seen: <Ago t={c.createdAt} />,
            topic: c.boardId ? (
              <Link href={`/studio/${c.boardId}`} aria-label={`Open topic for ${c.title}`}>
                Open topic
              </Link>
            ) : null,
          },
        }));
        return <Table caption="Discovery results" columns={columns} rows={rows} />;
      }}
    </Loaded>
  );
}

const loadRequests = () => listRequests();

function RequestsPanel({ topics }: { topics: BoardCard[] }) {
  const r = useLoad(loadRequests);
  const titles = new Map(topics.map((t) => [t.id, t.title ?? t.prompt]));
  return (
    <Loaded label="Requests" value={r}>
      {({ requests }: { requests: TopicRequestView[] }) => {
        if (!requests.length) return <EmptyState title="No requests" description="Nobody has asked a topic to track anything new." />;
        const byId = new Map(requests.map((q) => [String(q.id), q]));
        const columns: TableColumn[] = [
          { id: "when", label: "When", compare: (a, b) => byId.get(a.id)!.createdAt - byId.get(b.id)!.createdAt },
          { id: "text", label: "Request", rowHeader: true },
          { id: "topic", label: "Topic" },
          { id: "status", label: "Status" },
        ];
        const rows: TableRow[] = requests.map((q) => ({
          id: String(q.id),
          cells: {
            when: <Ago t={q.createdAt} />,
            text: q.text,
            topic: titles.get(q.boardId) ?? q.boardId,
            status: (
              <Badge variant="neutral" mono>
                {q.status}
              </Badge>
            ),
          },
        }));
        return <Table caption="Requests" columns={columns} rows={rows} />;
      }}
    </Loaded>
  );
}
