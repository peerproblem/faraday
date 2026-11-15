"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/link";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Caption, Text } from "@/components/ui/typography";
import { api } from "@/lib/config";
import type { ContextEvidenceItem, ContextEvidencePage } from "@/lib/spec";
import { when } from "@/lib/time";

const groups = [{ value: "search", label: "Search results" }, { value: "monitor", label: "Monitor changes" }] as const;
type Group = (typeof groups)[number]["value"];

async function fetchEvidence(boardId: string, group: Group, before?: number, signal?: AbortSignal): Promise<ContextEvidencePage> {
  const params = new URLSearchParams({ group });
  if (before) params.set("before", String(before));
  const res = await fetch(api(`/api/boards/${encodeURIComponent(boardId)}/evidence?${params}`), { cache: "no-store", signal });
  if (!res.ok) throw new Error("Could not load Context.dev evidence");
  return res.json();
}

function EvidenceLink({ url, title }: { url: string; title: string }) {
  return /^https?:\/\//i.test(url) ? <Link href={url} target="_blank" rel="noreferrer">{title}</Link> : <>{title}</>;
}

export function ContextEvidence({ boardId, checkedAt }: { boardId: string; checkedAt: number | null }) {
  const [group, setGroup] = useState<Group>("search");
  return (
    <section aria-label="Context.dev evidence" className="grid min-w-0 gap-2">
      <SegmentedControl<Group> aria-label="Context.dev evidence type" size="sm" value={group} options={groups} onValueChange={setGroup} />
      <EvidenceList key={`${boardId}:${group}:${checkedAt}`} boardId={boardId} group={group} />
    </section>
  );
}

function EvidenceList({ boardId, group }: { boardId: string; group: Group }) {
  const [items, setItems] = useState<ContextEvidenceItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetchEvidence(boardId, group, undefined, controller.signal).then((page) => {
      setItems(page.items);
      setNext(page.nextBefore);
      setError(false);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [boardId, group, retry]);

  async function loadMore() {
    if (!next || loading) return;
    setLoading(true);
    setError(false);
    try {
      const page = await fetchEvidence(boardId, group, next);
      setItems((previous) => {
        const have = new Set(previous.map((item) => item.id));
        return [...previous, ...page.items.filter((item) => !have.has(item.id))].sort((a, b) => b.id - a.id);
      });
      setNext(page.nextBefore);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <ul className="m-0 min-w-0 list-none divide-y divide-hairline p-0">
        {items.map((item) => (
          <li key={item.id} className="grid min-w-0 gap-1 py-2">
            <Caption>{item.kind === "monitor" ? "Monitor change" : item.kind === "news" ? "News search" : "Web search"}
              {item.publisher ? ` · ${item.publisher}` : ""}
              {` · ${when(item.detectedAt || item.publishedAt || new Date(item.collectedAt).toISOString())}`}
            </Caption>
            <Text size="sm" className="[overflow-wrap:anywhere]"><EvidenceLink url={item.url} title={item.title ?? item.url} /></Text>
            {item.summary && <Text size="sm" tone="muted">{item.summary}</Text>}
            {([
              ["Related sources", item.relatedUrls],
              ["Added URLs", item.addedUrls],
              ["Removed URLs", item.removedUrls],
            ] as const).map(([label, urls]) => urls?.length ? (
              <details key={label}>
                <summary className="cursor-pointer text-xs">{label} ({urls.length})</summary>
                <ul className="grid gap-1 text-xs [overflow-wrap:anywhere]">
                  {urls.map((url, i) => <li key={`${url}:${i}`}><EvidenceLink url={url} title={url} /></li>)}
                </ul>
              </details>
            ) : null)}
            {(item.before || item.after || item.diff || !!item.snapshots?.length) && (
              <details>
                <summary className="cursor-pointer text-xs">Source changes</summary>
                {[{ url: null, before: item.before, after: item.after }, ...(item.snapshots ?? [])].map((snapshot, index) => (
                  <div key={index} className="grid gap-1 py-1">
                    {snapshot.url && <EvidenceLink url={snapshot.url} title={snapshot.url} />}
                    {snapshot.before && <Text size="sm" className="whitespace-pre-wrap [overflow-wrap:anywhere]"><strong>Before</strong>{" "}{snapshot.before}</Text>}
                    {snapshot.after && <Text size="sm" className="whitespace-pre-wrap [overflow-wrap:anywhere]"><strong>After</strong>{" "}{snapshot.after}</Text>}
                  </div>
                ))}
                {item.diff && <pre className="m-0 max-h-52 overflow-auto whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{item.diff}</pre>}
              </details>
            )}
          </li>
        ))}
      </ul>
      {!items.length && !loading && !error && <Text size="sm" tone="muted">No {group === "search" ? "search results" : "monitor changes"} collected yet.</Text>}
      {loading && !items.length && <Text role="status" size="sm">Loading evidence…</Text>}
      {error && <Text role="alert" size="sm">Could not load evidence. <Button size="xs" variant="ghost" onClick={() => next ? void loadMore() : setRetry((value) => value + 1)}>Retry</Button></Text>}
      {next && <Button size="sm" variant="outline" loading={loading} onClick={() => void loadMore()}>Load older results</Button>}
    </>
  );
}
