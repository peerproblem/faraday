import { describe, expect, it } from "vitest";
import { useTestDb } from "../test/db";
import { createBoard } from "./boards";
import { contextEvidencePage, recordContextChanges, recordContextSearch } from "./context-evidence";

const { enabled } = useTestDb("context_evidence");

describe.skipIf(!enabled)("Context.dev evidence", () => {
  it("pages through search results and keeps distinct monitor updates for the same URL", async () => {
    const { id } = await createBoard("Storm near Portugal", null, { origin: "system" });
    const docs = Array.from({ length: 45 }, (_, i) => ({
      url: `https://example.test/article/${i}`, title: "Same headline", publisher: null,
      kind: "news" as const, publishedAt: null, snippet: null,
    }));
    await recordContextSearch(id, docs);
    await recordContextSearch(id, docs);
    const first = await contextEvidencePage(id, "search", Number.MAX_SAFE_INTEGER);
    expect(first.items).toHaveLength(40);
    expect(first.nextBefore).not.toBeNull();
    const rest = await contextEvidencePage(id, "search", first.nextBefore!);
    expect(rest.items).toHaveLength(5);
    expect(rest.nextBefore).toBeNull();

    const base = {
      monitorId: "m1", url: docs[0].url, title: "Changed", summary: null, importance: null,
      detectedAt: "2026-11-15T00:00:00Z", evidence: [],
    };
    const changes = [
      { ...base, id: "change-1", afterExcerpt: "First change" },
      { ...base, id: "change-2", afterExcerpt: "Second change", matchedUrls: [docs[1].url] },
    ];
    await recordContextChanges(id, changes);
    await recordContextChanges(id, changes);
    const monitor = await contextEvidencePage(id, "monitor", Number.MAX_SAFE_INTEGER);
    expect(monitor.items.map((item) => item.after)).toEqual(["Second change", "First change"]);
    expect(monitor.items[0].relatedUrls).toEqual([docs[1].url]);
  });
});
