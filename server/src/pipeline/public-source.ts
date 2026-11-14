import type { Source } from "../spec";

// A letter from any script other than Latin (Cyrillic, Greek, Arabic, Hebrew, Indic, Thai, Hangul, kana, CJK...).
// Digits, punctuation, symbols and accented Latin letters do not count.
const NON_LATIN = /[^\P{L}\p{Script=Latin}]/u;

export const hasNonLatinScript = (text: string | null | undefined) => !!text && NON_LATIN.test(text);

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/**
 * Whether a source's own words may be shown: not known to be another language, and no letters from a non-Latin script
 * in its title, snippet or publisher (this also catches a triage call that wrongly said English).
 */
export function isDisplayEnglish(s: Pick<Source, "lang" | "title" | "snippet" | "publisher">): boolean {
  if (s.lang && s.lang.toLowerCase() !== "en") return false;
  return !hasNonLatinScript(s.title) && !hasNonLatinScript(s.snippet) && !hasNonLatinScript(s.publisher);
}

/**
 * The source as clients may see it. The product is English only, so a non-English source is shown by its English
 * display title (or its host) with no snippet. The original title, snippet and page text stay on the server, where
 * verification and extraction keep using them. lang and titleEn are never sent.
 */
export function publicSource(s: Source): Source {
  const { lang: _lang, titleEn, ...rest } = s;
  const out: Source = { ...rest, via: s.via ?? null };
  if (isDisplayEnglish(s)) return out;
  const host = hostOf(s.url);
  const english = (t: string | null | undefined) => (t && t.trim() && !hasNonLatinScript(t) ? t.trim() : null);
  return {
    ...out,
    title: english(titleEn) ?? english(s.publisher) ?? host,
    publisher: english(s.publisher) ?? host,
    snippet: null,
  };
}

export const publicSources = (sources: Source[]) => sources.map(publicSource);
