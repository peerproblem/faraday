import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunCtx } from "../../graph/runner";
import type { FoundDoc } from "../../repo/boards";
import { addSources } from "../../repo/boards";
import { advanceSocialCursor } from "../../repo/social";
import { ingest } from "./common";

vi.mock("../../repo/boards", () => ({ addSources: vi.fn() }));
vi.mock("../../repo/social", () => ({ advanceSocialCursor: vi.fn() }));
const doc: FoundDoc = { url: "https://x.com/local/status/1", title: "local", publisher: "local", snippet: "report", kind: "social", publishedAt: null,
  socialCursor: { queryKey: "query", sinceId: "1" } };
const ctx = { boardId: "b", emit: vi.fn() } as unknown as RunCtx;
beforeEach(() => vi.clearAllMocks());
describe("social cursor acknowledgment", () => {
  it("advances only after successful ingestion, including a resumed duplicate ingestion", async () => {
    vi.mocked(addSources).mockResolvedValueOnce([]);
    await ingest(ctx, [doc]);
    expect(advanceSocialCursor).toHaveBeenCalledWith("b", "query", "1");
    expect(vi.mocked(addSources).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(advanceSocialCursor).mock.invocationCallOrder[0]);
  });
  it("leaves the cursor unchanged when storing sources fails", async () => {
    vi.mocked(addSources).mockRejectedValueOnce(new Error("DB unavailable"));
    await expect(ingest(ctx, [doc])).rejects.toThrow("DB unavailable");
    expect(advanceSocialCursor).not.toHaveBeenCalled();
  });
});
