import { createHash } from "node:crypto";
import { all, json, run } from "../db/pool";
import type { MonitorChange } from "../contextdev";
import { hasNonLatinScript } from "../pipeline/public-source";
import type { ContextEvidenceItem, ContextEvidenceKind, ContextEvidencePage } from "../spec";
import { urlKey, type FoundDoc } from "./boards";

type SearchDoc = FoundDoc & { kind: "news" | "web" };
type Payload = Omit<ContextEvidenceItem, "id" | "kind" | "collectedAt">;

// Write each page before requesting the next one. Replayed pages and webhook retries are idempotent.
async function record(boardId: string, kind: ContextEvidenceKind, rows: { key: string; payload: Payload }[]) {
  if (!rows.length) return;
  const now = Date.now();
  for (let i = 0; i < rows.length; i += 100) {
    const page = rows.slice(i, i + 100);
    await run(
      `INSERT INTO context_evidence (board_id, kind, result_key, payload, collected_at)
     VALUES ${page.map(() => "(?, ?, ?, ?, ?)").join(", ")}
     ON DUPLICATE KEY UPDATE result_key = VALUES(result_key)`,
      page.flatMap(({ key, payload }) => [
        boardId, kind, createHash("sha256").update(key).digest("hex"), JSON.stringify(payload), now,
      ]),
    );
  }
}

export async function recordContextSearch(boardId: string, docs: FoundDoc[]) {
  for (const kind of ["news", "web"] as const) {
    const results = docs.filter((doc): doc is SearchDoc => doc.kind === kind);
    await record(boardId, kind, results.map(({ url, title, publisher, publishedAt }) => ({
      key: urlKey(url).trim(),
      payload: { url, title: title && !hasNonLatinScript(title) ? title : url, publisher, publishedAt },
    })));
  }
}

export async function recordContextChanges(boardId: string, changes: MonitorChange[]) {
  await record(boardId, "monitor", changes.map((change) => ({
    key: change.id,
    payload: {
      url: change.url, title: change.title, summary: change.summary, detectedAt: change.detectedAt,
      importance: change.importance, before: change.beforeExcerpt, after: change.afterExcerpt, diff: change.diff,
      snapshots: change.snapshots,
      addedUrls: change.addedUrls, removedUrls: change.removedUrls,
      relatedUrls: [...new Set([...(change.matchedUrls ?? []), ...change.evidence.flatMap((item) => item.url ? [item.url] : [])])],
    },
  })));
}

const pageSize = 40;

export async function contextEvidencePage(boardId: string, group: "search" | "monitor", before: number, through?: number): Promise<ContextEvidencePage> {
  const rows = await all<{ id: number; kind: ContextEvidenceKind; payload: string; collected_at: number }>(
    `SELECT id, kind, payload, collected_at FROM context_evidence
     WHERE board_id = ? AND kind ${group === "monitor" ? "= 'monitor'" : "IN ('web', 'news')"}
     AND id < ? ${through === undefined ? "" : "AND collected_at <= ?"} ORDER BY id DESC LIMIT ?`,
    through === undefined ? [boardId, before, pageSize + 1] : [boardId, before, through, pageSize + 1],
  );
  const items = rows.slice(0, pageSize).map((row) => ({
    ...json<Payload>(row.payload)!,
    id: Number(row.id),
    kind: row.kind,
    collectedAt: Number(row.collected_at),
  }));
  return { items, nextBefore: rows.length > pageSize ? items.at(-1)!.id : null };
}
