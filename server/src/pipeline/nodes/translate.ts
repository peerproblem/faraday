import { generateText, Output } from "ai";
import { z } from "zod";
import { fastLlm } from "../../llm/models";
import type { Usage } from "../../graph/runner";
import type { Fact, Source } from "../../spec";
import { quotedSourceId, quoteNeedsTranslation } from "../evidence";
import { hasNonLatinScript } from "../public-source";
import { isSocialSource } from "../trust";
import { call } from "./util";

export type QuoteToTranslate = { id: number; quote: string; lang: string | null };
export type QuoteTranslation = { id: number; quoteEn: string };

/** Quotes translated in one round (one model call). The rest wait for the next round. */
export const MAX_QUOTES = 40;

/**
 * The quotes that still need English: active facts from a non-English source with no translation yet. Posts come
 * first (the on-the-ground widget shows nothing but their words), then the newest facts.
 */
export function pickQuotes(facts: Fact[], sources: Source[], max = MAX_QUOTES): QuoteToTranslate[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const rows: { q: QuoteToTranslate; social: boolean }[] = [];
  for (const f of facts) {
    const quote = f.quote?.trim();
    const id = quotedSourceId(f);
    const source = id ? byId.get(id) : undefined;
    if (!quote || !source || f.quoteEn || f.status !== "active" || !quoteNeedsTranslation(quote, source)) continue;
    rows.push({ q: { id: f.id, quote, lang: source.lang && source.lang !== "und" ? source.lang : null }, social: isSocialSource(source) });
  }
  return rows
    .sort((a, b) => Number(b.social) - Number(a.social) || b.q.id - a.q.id)
    .slice(0, Math.max(0, max))
    .map((r) => r.q);
}

/** Runs of digits. Separators split a number the same way on both sides: 3.000 and 3,000 are both "3" and "000". */
const figures = (text: string) => text.match(/\d+/g) ?? [];

/**
 * A translation may not bring a figure the source did not write: every run of digits in it must be in the
 * original. (The other way round is allowed: a figure may be spelled out in English.)
 */
export function keepsFigures(original: string, translation: string): boolean {
  const have = new Set(figures(original));
  return figures(translation).every((n) => have.has(n));
}

const schema = z.object({
  translations: z.array(z.object({ id: z.number().int(), english: z.string().describe("The sentence in plain English") })),
});

/**
 * English translations of verified quotes, in one model call. A translation that is empty, not in the Latin
 * script, or that contains a number the original lacks is dropped: that fact then shows no quote at all.
 */
export async function translateQuotes(items: QuoteToTranslate[], use: Usage, signal: AbortSignal): Promise<QuoteTranslation[]> {
  if (!items.length) return [];
  const llm = fastLlm();
  const r = await generateText({
    ...call(llm),
    output: Output.object({ schema }),
    system: `You translate sentences quoted from news pages and social posts about a crisis into plain English.
Translate only: add nothing, leave nothing out, and do not explain. Keep names of people, places and organisations as written.
Keep every number exactly as it is written: digits stay digits and number words become number words.
Hashtags, handles and URLs stay as they are. English only.`,
    prompt: JSON.stringify(items.map((q) => ({ id: q.id, ...(q.lang ? { language: q.lang } : {}), sentence: q.quote }))),
    abortSignal: signal,
  });
  use.llm(llm.modelId, r.usage);
  const byId = new Map(items.map((q) => [q.id, q]));
  const seen = new Set<number>();
  const out: QuoteTranslation[] = [];
  for (const t of r.output?.translations ?? []) {
    const src = byId.get(t.id);
    const english = t.english?.replace(/\s+/g, " ").trim();
    if (!src || seen.has(t.id) || !english || hasNonLatinScript(english) || !keepsFigures(src.quote, english)) continue;
    seen.add(t.id);
    out.push({ id: t.id, quoteEn: english.slice(0, 1000) });
  }
  return out;
}
