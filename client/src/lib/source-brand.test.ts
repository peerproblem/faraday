import { describe, expect, it } from "vitest";
import type { Source } from "./spec";
import { brandOf, excerptOf, handleOf, hostOf, isSafeHost, latestSources, outletsOf, sourceLabel } from "./source-brand";

const src = (patch: Partial<Source>): Source => ({
  id: "s1", url: "https://example.org/a", title: "A headline", publisher: null, kind: "news", publishedAt: null, fetchedAt: 0, snippet: null, relevance: null, sourceType: "news", ...patch,
});

describe("who a source is", () => {
  it("reads the publisher's host without www, m or amp", () => {
    expect(hostOf("https://www.elpais.com/espana/x.html")).toBe("elpais.com");
    expect(hostOf("https://m.dw.com/en/a")).toBe("dw.com");
    expect(hostOf("javascript:alert(1)")).toBeNull();
    expect(hostOf("not a url")).toBeNull();
  });

  it("knows a platform by its host, subdomains included", () => {
    expect(brandOf({ url: "https://twitter.com/a/status/1", publisher: "@a" })).toMatchObject({ key: "x", platform: "x", name: "X", logo: null });
    expect(brandOf({ url: "https://old.reddit.com/r/spain/comments/1", publisher: null }).platform).toBe("reddit");
    expect(brandOf({ url: "https://es.wikipedia.org/wiki/Huelga", publisher: "Wikipedia" }).platform).toBe("wikipedia");
    // A host that only ends like a platform's is not that platform.
    expect(brandOf({ url: "https://notreddit.com/a", publisher: null }).platform).toBeNull();
  });

  it("gives a site its publisher name and a logo path that only holds a hostname", () => {
    expect(brandOf({ url: "https://www.dw.com/en/a", publisher: "DW" })).toMatchObject({ key: "dw.com", name: "DW", logo: "/api/source-logo/dw.com" });
    expect(brandOf({ url: "https://elpais.com/a", publisher: null }).name).toBe("elpais.com");
    expect(isSafeHost("dw.com")).toBe(true);
    for (const bad of ["localhost", "a..b", "dw.com/../x", "dw.com?x=1", "-a.com", "a b.com", ""]) expect(isSafeHost(bad)).toBe(false);
  });

  it("names a post by its account or community", () => {
    expect(handleOf("https://x.com/local_report/status/19")).toBe("@local_report");
    expect(handleOf("https://x.com/search?q=flood")).toBeNull();
    expect(handleOf("https://www.reddit.com/r/spain/comments/1ab/title/")).toBe("r/spain");
    expect(handleOf("https://t.me/s/civil_protection/12")).toBe("@civil_protection");
    expect(handleOf("https://bsky.app/profile/a.bsky.social/post/3k")).toBe("@a.bsky.social");
    expect(sourceLabel({ url: "https://www.youtube.com/watch?v=abc", publisher: "City council" })).toBe("City council");
    expect(sourceLabel({ url: "https://www.youtube.com/watch?v=abc", publisher: null })).toBe("YouTube");
    expect(sourceLabel({ url: "https://dw.com/a", publisher: "DW" })).toBe("DW");
  });
});

describe("a source's own words", () => {
  it("keeps the first real paragraph and drops the page furniture after it", () => {
    expect(excerptOf(src({ snippet: "At least 115 people arrested nationwide\nSwipe for next article More than 3 million take to the streets" }))).toBe("At least 115 people arrested nationwide");
  });

  it("skips a first line that only repeats the headline", () => {
    expect(excerptOf(src({ title: "Spain strikes", snippet: "Spain strikes\nUnions called the stoppage massive and employers called it a failure." }))).toBe(
      "Unions called the stoppage massive and employers called it a failure.",
    );
  });

  it("cuts a long passage at a sentence, or at a word", () => {
    const long = `${"Workers shut down transport across the country. ".repeat(3)}${"word ".repeat(60)}`;
    const cut = excerptOf(src({ snippet: long }), 160)!;
    expect(cut.length).toBeLessThanOrEqual(160);
    expect(cut.endsWith(".")).toBe(true);
    expect(excerptOf(src({ snippet: "word ".repeat(80) }), 100)!.endsWith("…")).toBe(true);
    expect(excerptOf(src({ snippet: "   " }))).toBeNull();
  });
});

describe("outlets and the wire", () => {
  const sources = [
    src({ id: "a", url: "https://dw.com/1", publisher: "DW", publishedAt: "2026-11-11T10:00:00Z" }),
    src({ id: "b", url: "https://www.dw.com/2", publisher: "DW", publishedAt: "2026-11-12T10:00:00Z", title: "Second" }),
    src({ id: "c", url: "https://elpais.com/1", publisher: null, publishedAt: "2026-11-12T09:00:00Z", title: "Third" }),
    src({ id: "d", url: "https://x.com/a/status/1", publisher: "@a", kind: "social", sourceType: "social", title: "@a", publishedAt: "2026-11-13T09:00:00Z" }),
  ];

  it("groups sources by outlet, the most cited first", () => {
    expect(outletsOf(sources).map((o) => [o.key, o.count])).toEqual([["dw.com", 2], ["x", 1], ["elpais.com", 1]]);
  });

  it("puts the newest headlines on the wire and never an unverified post", () => {
    expect(latestSources(sources).map((s) => s.id)).toEqual(["b", "c", "a"]);
  });
});
