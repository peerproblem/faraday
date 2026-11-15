import { officialBreakdown, officialCount, reportingTime } from "../spec/incident";
// OWNER: F-PIPE-CORE. Code-only verification (guide P3-6). No model calls.
import type { ExtractedFact, FactKind, Source, StagedFact } from "../spec";

export type VerifyInput = {
  facts: ExtractedFact[];
  /** The source ids that were in the extraction batch of each fact are checked by the caller; here every known source. */
  sources: Source[];
  /** Full Markdown for sources that were read; others fall back to title + snippet. */
  texts: Map<string, string>;
};
export type VerifyResult = { accepted: StagedFact[]; rejected: { fact: ExtractedFact; reason: string }[] };

const MIN_QUOTE_CHARS = 8;
const MAX_QUOTE_CHARS = 600;

/** Lowercase, NFKC, markdown and typographic noise removed, whitespace collapsed. Applied to quotes and sources alike. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/­/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]{1,200}>/g, " ")
    .replace(/[*_`#>|~]+/g, " ")
    .replace(/[‘’‚′´`]/g, "'")
    .replace(/[“”„″«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function quoteSegments(quote: string): string[] {
  const q = normalizeText(quote).replace(/^["'\s]+|["'\s.,;:!?]+$/g, "");
  return q
    .split(/\s*\.\.\.+\s*/)
    .map((x) => x.replace(/^["'\s.,;:!?]+|["'\s.,;:!?]+$/g, "").trim())
    .filter(Boolean);
}

/** True when every segment of the quote (split at ellipses) appears in the corpus, in order. */
export function quoteInText(quote: string, corpus: string): boolean {
  const segs = quoteSegments(quote);
  if (!segs.length) return false;
  const text = normalizeText(corpus);
  let pos = 0;
  for (const seg of segs) {
    const i = text.indexOf(seg, pos);
    if (i < 0) return false;
    pos = i + seg.length;
  }
  return true;
}

// ---------- numbers ----------

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  dozen: 12,
};

const SCALE_WORDS: [RegExp, number][] = [
  [/^\s*(?:billions?|bn|mrd\.?|milliards?|mil millones)(?![\p{L}])/iu, 1e9],
  [/^\s*(?:millions?|millones|millón|million|milhões|milhão|mio\.?|mln|mn)(?![\p{L}])/iu, 1e6],
  [/^\s*(?:thousands?|tausend|mil|k)(?![\p{L}])/iu, 1e3],
  [/^\s*lakhs?(?![\p{L}])/iu, 1e5],
  [/^\s*crores?(?![\p{L}])/iu, 1e7],
];
const KO_SCALES: [string, number][] = [
  ["천만", 1e7],
  ["백만", 1e6],
  ["조", 1e12],
  ["억", 1e8],
  ["만", 1e4],
  ["천", 1e3],
];

const NUM_RE =
  /(?:(?<=^|[\s(:])([-−]))?(?<![\p{N}.,])(\d{1,3}(?:(?:,\d{3})+|(?:\.\d{3})+|(?:[   ]\d{3})+)(?:[.,]\d+)?|\d+(?:[.,]\d+)?)/gu;
const WORD_RE = new RegExp(`(?<![\\p{L}])(${Object.keys(WORD_NUMBERS).join("|")})(?![\\p{L}])`, "giu");

/** Reads one digit token with its separators. */
export function interpretDigits(token: string): number | null {
  let s = token.replace(/[   ]/g, "");
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const grp = dec === "," ? "." : ",";
    s = s.split(grp).join("").replace(dec, ".");
  } else if (hasComma || hasDot) {
    const sep = hasComma ? "," : ".";
    const parts = s.split(sep);
    if (parts.length > 2) s = parts.join("");
    else {
      const [int, frac] = parts;
      // One separator followed by exactly three digits is a thousands separator ("12,400", "2.500"), unless the
      // integer part is 0 ("0.125").
      s = frac.length === 3 && !/^0+$/.test(int) ? int + frac : `${int}.${frac}`;
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

type Scanned = { index: number; end: number; raw: number; value: number };

function applyScale(text: string, end: number, raw: number): { value: number; end: number } {
  const rest = text.slice(end);
  for (const [re, mult] of SCALE_WORDS) {
    const m = rest.match(re);
    if (m) return { value: raw * mult, end: end + m[0].length };
  }
  const ko = rest.match(/^\s?(천만|백만|조|억|만|천)/);
  if (ko) {
    const mult = KO_SCALES.find(([u]) => u === ko[1])![1];
    return { value: raw * mult, end: end + ko[0].length };
  }
  return { value: raw, end };
}

/** Every number in the text, in order, with scale words applied. Korean composites like "1억 2천만" are combined. */
export function scanNumbers(text: string): Scanned[] {
  const t = text.normalize("NFKC");
  const out: Scanned[] = [];
  for (const m of t.matchAll(NUM_RE)) {
    const digits = m[2];
    let raw = interpretDigits(digits);
    if (raw === null) continue;
    if (m[1]) raw = -raw;
    const index = m.index!;
    const scaled = applyScale(t, index + m[0].length, raw);
    out.push({ index, end: scaled.end, raw, value: scaled.value });
  }
  for (const m of t.matchAll(WORD_RE)) {
    const raw = WORD_NUMBERS[m[1].toLowerCase()];
    const index = m.index!;
    const scaled = applyScale(t, index + m[0].length, raw);
    out.push({ index, end: scaled.end, raw, value: scaled.value });
  }
  out.sort((a, b) => a.index - b.index);
  // Korean composite: "1억 2,000만" = 1e8 + 2e7. Only when the parts are adjacent and the first scale is bigger.
  const merged: Scanned[] = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.value !== prev.raw &&
      s.value !== s.raw &&
      /^\s*$/.test(t.slice(prev.end, s.index)) &&
      Math.abs(prev.value) > Math.abs(s.value) &&
      /[조억만]$/.test(t.slice(prev.index, prev.end).trim())
    ) {
      merged[merged.length - 1] = { index: prev.index, end: s.end, raw: prev.raw, value: prev.value + s.value };
      continue;
    }
    merged.push(s);
  }
  return merged;
}

/** "12,400" -> 12400, "1.2 million" -> 1200000, "3 of 7" -> 3, "about 40" -> 40, "1.234,5" (de) -> 1234.5. Null when no number. */
export function parseNumber(text: string): number | null {
  const first = scanNumbers(text)[0];
  return first ? first.value : null;
}

/** Every number a reader could take from the text: scaled values and the raw figures before scale words. */
export function extractNumbers(text: string): number[] {
  const seen = new Set<number>();
  for (const s of scanNumbers(text)) {
    seen.add(s.value);
    seen.add(s.raw);
    seen.add(Math.abs(s.value));
  }
  return [...seen];
}

export function numbersEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-6);
}

// ---------- urls ----------

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ---------- verify ----------

const str = (x: unknown) => typeof x === "string" && x.trim().length > 0;
const SERVICE_STATES = new Set(["operational", "degraded", "down", "unknown"]);

function shapeError(f: ExtractedFact): string | null {
  const p = f.payload as unknown as Record<string, unknown>;
  if (!p || typeof p !== "object") return "payload missing";
  if (!str(f.key)) return "key missing";
  const need = (...keys: string[]) => (keys.every((k) => str(p[k])) ? null : `payload needs ${keys.join(", ")}`);
  switch (f.kind as FactKind) {
    case "metric":
      return need("valueText");
    case "event":
      return need("title");
    case "place":
      return need("name");
    case "advisory":
      return need("title");
    case "resource":
      return need("label", "url");
    case "row":
      return str(p.table) && p.cells && typeof p.cells === "object" ? null : "row needs table and cells";
    case "status":
      return need("group", "name") ?? (SERVICE_STATES.has(String(p.state)) ? null : "status state invalid");
    default:
      return `unknown kind ${String(f.kind)}`;
  }
}

export function verifyFacts(input: VerifyInput): VerifyResult {
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  const hosts = new Set(input.sources.map((s) => hostOf(s.url)).filter((h): h is string => !!h));
  const corpusCache = new Map<string, string>();
  const corpusOf = (s: Source) => {
    let c = corpusCache.get(s.id);
    if (c === undefined) {
      c = [s.title ?? "", s.snippet ?? "", input.texts.get(s.id) ?? ""].join("\n");
      corpusCache.set(s.id, c);
    }
    return c;
  };
  let allText: string | null = null;
  const hostKnown = (url: string) => {
    const h = hostOf(url);
    if (!h) return false;
    if (hosts.has(h)) return true;
    allText ??= input.sources
      .map((s) => `${s.url} ${s.snippet ?? ""} ${input.texts.get(s.id) ?? ""}`)
      .join(" ")
      .toLowerCase();
    return allText.includes(h);
  };

  const accepted: StagedFact[] = [];
  const rejected: VerifyResult["rejected"] = [];
  const reject = (fact: ExtractedFact, reason: string) => rejected.push({ fact, reason });

  for (const fact of input.facts) {
    const source = byId.get(fact.sourceId);
    if (!source) {
      reject(fact, `unknown source ${fact.sourceId}`);
      continue;
    }
    const shape = shapeError(fact);
    if (shape) {
      reject(fact, shape);
      continue;
    }
    const quote = typeof fact.quote === "string" ? fact.quote.trim() : "";
    if (normalizeText(quote).length < MIN_QUOTE_CHARS) {
      reject(fact, "quote too short");
      continue;
    }
    if (quote.length > MAX_QUOTE_CHARS) {
      reject(fact, "quote too long");
      continue;
    }
    if (!quoteInText(quote, corpusOf(source))) {
      reject(fact, "quote not found in source");
      continue;
    }

    let payload = fact.payload;
    let valueNum: number | null = null;
    if (fact.kind === "metric") {
      const p = fact.payload as StagedFact["payload"] & { valueText: string; valueNum: number | null };
      const inQuote = extractNumbers(quote);
      const has = (n: number | null) => n !== null && Number.isFinite(n) && inQuote.some((q) => numbersEqual(q, n));
      const fromText = parseNumber(p.valueText);
      const fromModel = typeof p.valueNum === "number" && Number.isFinite(p.valueNum) ? p.valueNum : null;
      if (has(fromText)) valueNum = fromText;
      else if (has(fromModel)) valueNum = fromModel;
      else {
        reject(fact, fromText === null && fromModel === null ? "metric has no number" : "metric value not in quote");
        continue;
      }
      payload = { ...p, valueNum };
    } else if (fact.kind === "row") {
      const row = fact.payload as { table: string; cells: Record<string, string> };
      if (row.table === "operational-incidents" || row.table === "incident-totals") {
        if (source.sourceType !== "official") {
          reject(fact, "response rows require an official source");
          continue;
        }
        if (row.table === "operational-incidents" && reportingTime(row.cells["status-as-of"]) === null) {
          reject(fact, "official response status requires an observation time");
          continue;
        }
        if (row.table === "incident-totals") {
          const count = officialCount(row.cells["total-incidents"]);
          const numbers = extractNumbers(quote);
          if (count === null || !numbers.includes(count) || reportingTime(row.cells["reporting-window-end"]) === null) {
            reject(fact, "official incident count or reporting cutoff unverified");
            continue;
          }
          const slices = officialBreakdown(row.cells.breakdown, count);
          if (row.cells.breakdown && (!slices || slices.some(({ value }) => !numbers.includes(value)))) {
            const { breakdown: _breakdown, ...cells } = row.cells;
            payload = { ...row, cells };
          }
        }
      }
    } else if (fact.kind === "resource") {
      const p = fact.payload as { url: string };
      if (!hostKnown(p.url)) {
        reject(fact, "resource url host not in sources");
        continue;
      }
    } else if (fact.kind === "advisory") {
      const p = fact.payload as { url: string | null };
      if (p.url && !hostKnown(p.url)) payload = { ...(fact.payload as object), url: null } as typeof fact.payload;
    }

    accepted.push({
      ...fact,
      quote,
      payload,
      valueNum,
      sourceType: source.sourceType,
      relevance: source.relevance,
    } as StagedFact);
  }
  return { accepted, rejected };
}
