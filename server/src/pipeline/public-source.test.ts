import { describe, expect, it } from "vitest";
import type { Source } from "../spec";
import { hasNonLatinScript, isDisplayEnglish, publicSource, publicSources } from "./public-source";

const src = (over: Partial<Source> = {}): Source => ({
  id: "s1",
  url: "https://www.example.ua/news/1",
  title: "Power cuts in Kyiv",
  publisher: "example.ua",
  kind: "web",
  publishedAt: null,
  fetchedAt: 1,
  snippet: "Schedules apply from 08:00.",
  relevance: 0.9,
  sourceType: "official",
  via: "oxylabs",
  lang: "en",
  titleEn: null,
  ...over,
});

describe("publicSource", () => {
  it("leaves English sources as they are and never sends lang or titleEn", () => {
    const out = publicSource(src());
    expect(out.title).toBe("Power cuts in Kyiv");
    expect(out.snippet).toBe("Schedules apply from 08:00.");
    expect(out.via).toBe("oxylabs");
    expect("lang" in out).toBe(false);
    expect("titleEn" in out).toBe(false);
  });

  it("shows a non-English source by its English title with no snippet", () => {
    const out = publicSource(src({ lang: "uk", title: "Графіки відключень у Києві", snippet: "Графіки діють з 08:00", titleEn: "Outage schedules in Kyiv" }));
    expect(out.title).toBe("Outage schedules in Kyiv");
    expect(out.snippet).toBeNull();
  });

  it("falls back to the publisher or host when there is no usable English title", () => {
    expect(publicSource(src({ lang: "uk", title: "Графіки", titleEn: null })).title).toBe("example.ua");
    expect(publicSource(src({ lang: "uk", title: "Графіки", titleEn: "Графіки", publisher: "Укренерго" })).title).toBe("example.ua");
    expect(publicSource(src({ lang: "uk", title: "Графіки", titleEn: "Графіки", publisher: "Укренерго" })).publisher).toBe("example.ua");
  });

  it("treats a Latin-script source in another language as non-English once triage says so", () => {
    const out = publicSource(src({ lang: "de", title: "Stromausfall in Berlin", titleEn: "Power cut in Berlin" }));
    expect(out.title).toBe("Power cut in Berlin");
    expect(out.snippet).toBeNull();
  });

  it("hides untriaged sources whose text uses a non-Latin script", () => {
    const out = publicSource(src({ lang: null, title: "Новини Києва", snippet: "Світла немає" }));
    expect(out.title).toBe("example.ua");
    expect(out.snippet).toBeNull();
    const korean = publicSource(src({ lang: null, title: "Seoul update", snippet: "정전 소식" }));
    expect(korean.snippet).toBeNull();
  });

  it("does not trust an English triage call when the title is in another script", () => {
    expect(isDisplayEnglish(src({ lang: "en", title: "停电通知" }))).toBe(false);
  });

  it("keeps untriaged Latin-script sources", () => {
    expect(publicSource(src({ lang: null })).title).toBe("Power cuts in Kyiv");
    expect(publicSources([src({ via: undefined })])[0].via).toBeNull();
  });

  it("detects non-Latin scripts but not punctuation or accents", () => {
    expect(hasNonLatinScript("Café – 12:00 • €5")).toBe(false);
    expect(hasNonLatinScript("Київ")).toBe(true);
    expect(hasNonLatinScript("東京")).toBe(true);
    expect(hasNonLatinScript(null)).toBe(false);
  });
});
