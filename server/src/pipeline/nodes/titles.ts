import { generateText, Output } from "ai";
import { z } from "zod";
import { fastLlm } from "../../llm/models";
import type { Usage } from "../../graph/runner";
import type { Source } from "../../spec";
import { hasNonLatinScript } from "../public-source";
import { call } from "./util";

export type SourceTitle = { id: string; lang: string; titleEn: string | null };

const MAX_TITLES = 40;

const schema = z.object({
  titles: z.array(
    z.object({
      id: z.string(),
      lang: z.string().describe("ISO 639-1 code of the source's language, e.g. uk, de, fi"),
      title: z.string().describe("A short English title, at most 120 characters"),
    }),
  ),
});

/**
 * English display titles for non-English sources, in one model call. The board is English only, so these replace the
 * original titles in the UI; the original text stays on the server for verification. Social posts keep their handle
 * as the title, so they only get a language. A title that is not plain English text is dropped (the UI then shows
 * the host instead).
 */
export async function englishTitles(sources: Source[], use: Usage, signal: AbortSignal): Promise<SourceTitle[]> {
  const pages = sources.filter((s) => s.kind !== "social");
  const targets = pages.slice(0, MAX_TITLES);
  const social = sources.filter((s) => s.kind === "social").map((s) => ({ id: s.id, lang: "und", titleEn: null }));
  // Sources past the cap get no title, but are still marked non-English so their own words stay hidden.
  const untitled = pages.slice(MAX_TITLES).map((s) => ({ id: s.id, lang: "und", titleEn: null }));
  if (!targets.length) return social;
  const llm = fastLlm();
  const r = await generateText({
    ...call(llm),
    output: Output.object({ schema }),
    system: `You write English display titles for web sources about a crisis. For each source, say which language it is in and translate its title into short, plain English (at most 120 characters). If the title is empty or useless, describe the page from its snippet in a few words. Translate only: add no facts, figures or opinions that are not in the source. English only.`,
    prompt: JSON.stringify(
      targets.map((s) => ({ id: s.id, title: s.title ?? "", publisher: s.publisher ?? "", snippet: (s.snippet ?? "").slice(0, 300) })),
    ),
    abortSignal: signal,
  });
  use.llm(llm.modelId, r.usage);
  const ids = new Set(targets.map((s) => s.id));
  const seen = new Set<string>();
  const out: SourceTitle[] = [];
  for (const t of r.output?.titles ?? []) {
    if (!ids.has(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    const title = t.title.replace(/\s+/g, " ").trim().slice(0, 120);
    const lang = /^[a-z]{2,3}$/i.test(t.lang.trim()) ? t.lang.trim().toLowerCase() : "und";
    out.push({ id: t.id, lang: lang === "en" ? "und" : lang, titleEn: title && !hasNonLatinScript(title) ? title : null });
  }
  // Sources the model skipped are still marked non-English, so the UI hides their own words.
  for (const s of targets) if (!seen.has(s.id)) out.push({ id: s.id, lang: "und", titleEn: null });
  return [...out, ...untitled, ...social];
}
