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
import { ToneBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TextLink } from "@/components/ui/link";
import { Switch } from "@/components/ui/switch";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { OverlayHost, toast } from "@/components/ui/toast";
import { Caption, Display, Text } from "@/components/ui/typography";
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
        <Display as="h1" size="md">
          Admin sign-in
        </Display>
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
          <Display as="h1" size="md">
            Admin
          </Display>
        </div>
        <div className="ml-auto">
          <Button variant="outline" size="sm" loading={signingOut} onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding="md" className="gap-3">
          <h2 className="m-0 flex">
            <Caption>Discovery</Caption>
          </h2>
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
      <h2 className="m-0 flex">
        <Caption>Register a topic</Caption>
      </h2>
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
  if (!topics.length) return <Text size="sm" tone="muted">No topics yet. Register one above.</Text>;

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

  return (
    <ul className="divide-y divide-hairline">
      {topics.map((t) => {
        const s = boardBadge(t);
        const archived = t.topicState === "archived";
        return (
          <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
            <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
              <Text className="font-medium">{t.title ?? t.prompt}</Text>
              <div className="flex flex-wrap items-center gap-2">
                <ToneBadge tone={s.tone}>{s.text}</ToneBadge>
                <ToneBadge tone="neutral" mono>
                  {archived ? "archived" : (t.topicState ?? "active")}
                </ToneBadge>
                {t.crisisType ? (
                  <ToneBadge tone="neutral" mono>
                    {t.crisisType}
                  </ToneBadge>
                ) : null}
                <Text as="span" size="sm" tone="muted">
                  updated <Ago t={t.updatedAt} />
                </Text>
              </div>
            </div>
            <Text as="div" size="sm" className="flex flex-wrap items-center gap-3">
              <TextLink href={boardUrl(t.slug)}>Board</TextLink>
              <TextLink href={`/studio/${t.id}`}>Studio</TextLink>
            </Text>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" loading={busy === t.id} onClick={() => void changeState(t, archived ? "active" : "archived")}>
                {archived ? "Restore" : "Archive"}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger variant="danger" size="sm">
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
                    <AlertDialogAction variant="danger" onClick={() => remove(t)}>
                      Delete forever
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </li>
        );
      })}
    </ul>
  );
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

function Loaded<T>({ value, children }: { value: T | Error | null; children: (v: T) => ReactNode }) {
  if (value === null)
    return (
      <Text size="sm" tone="muted">
        Loading…
      </Text>
    );
  if (value instanceof Error)
    return (
      <Text size="sm" className="text-danger" role="alert">
        {value.message}
      </Text>
    );
  return <>{children(value)}</>;
}

const decisionClass: Record<TopicCandidateView["decision"], string> = {
  created: "text-success",
  matched: "text-accent",
  rejected: "text-muted-foreground",
  deferred: "text-warning",
};

const loadCandidates = () => listCandidates(50);

function DiscoveryPanel() {
  const r = useLoad(loadCandidates);
  return (
    <Loaded value={r}>
      {({ candidates }) =>
        candidates.length ? (
          <ul className="grid gap-3">
            {candidates.map((c) => (
              <li key={c.id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Text as="span" size="sm" className="font-medium">
                    {c.title}
                  </Text>
                  <span className={`font-mono text-xs ${decisionClass[c.decision] ?? ""}`}>{c.decision}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {c.crisisType} {c.score.toFixed(2)}
                  </span>
                </div>
                <Text size="sm" tone="muted">
                  {[c.locationName, c.reason].filter(Boolean).join(". ")} <Ago t={c.createdAt} />
                </Text>
                {c.boardId ? (
                  <Text as="span" size="sm">
                    <TextLink href={`/studio/${c.boardId}`}>Open topic</TextLink>
                  </Text>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Text size="sm" tone="muted">
            Nothing yet. Discovery results appear after the scheduler runs with discovery on.
          </Text>
        )
      }
    </Loaded>
  );
}

const loadRequests = () => listRequests();

function RequestsPanel({ topics }: { topics: BoardCard[] }) {
  const r = useLoad(loadRequests);
  const titles = new Map(topics.map((t) => [t.id, t.title ?? t.prompt]));
  return (
    <Loaded value={r}>
      {({ requests }: { requests: TopicRequestView[] }) =>
        requests.length ? (
          <ul className="grid gap-2">
            {requests.map((q) => (
              <li key={q.id} className="flex flex-wrap gap-x-3 gap-y-1">
                <Text as="span" size="sm" tone="muted" className="w-16 shrink-0 font-mono text-xs leading-5">
                  <Ago t={q.createdAt} />
                </Text>
                <Text as="span" size="sm" className="min-w-0 flex-1 basis-60">
                  {q.text}
                </Text>
                <Text as="span" size="sm" tone="muted">
                  {titles.get(q.boardId) ?? q.boardId}, {q.status}
                </Text>
              </li>
            ))}
          </ul>
        ) : (
          <Text size="sm" tone="muted">
            Nobody has asked a topic to track anything new.
          </Text>
        )
      }
    </Loaded>
  );
}
