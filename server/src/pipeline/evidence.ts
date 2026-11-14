import type { Evidence, Fact, Source } from "../spec";
import { hasNonLatinScript } from "./public-source";

/**
 * Whether a quote may be shown as it is. The board is English only, so a sentence from a source in another
 * language (or with letters from another script, whatever triage said) needs an English translation first.
 */
export function quoteNeedsTranslation(quote: string, source: Pick<Source, "lang">): boolean {
  if (source.lang && source.lang.toLowerCase() !== "en") return true;
  return hasNonLatinScript(quote);
}

/** The source a fact's quote was copied from: the first one. Sources that confirm it later are appended after it. */
export const quotedSourceId = (f: Pick<Fact, "sourceIds">): string | undefined => f.sourceIds[0];

/**
 * The verified sentence behind a fact, as clients may see it. An English source gives its own words. Another
 * language gives the translation, with the source's words beside it. No translation yet means no evidence:
 * the original alone is never sent.
 */
export function evidenceOf(f: Pick<Fact, "quote" | "quoteEn" | "sourceIds">, sources: Map<string, Source>): Evidence | undefined {
  const quote = f.quote?.trim();
  const id = quotedSourceId(f);
  const source = id ? sources.get(id) : undefined;
  if (!quote || !id || !source) return undefined;
  if (!quoteNeedsTranslation(quote, source)) return { source: id, quote };
  const english = f.quoteEn?.trim();
  if (!english || hasNonLatinScript(english)) return undefined;
  return { source: id, quote: english, original: quote };
}
