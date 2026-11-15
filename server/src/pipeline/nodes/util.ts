import type { Llm } from "../../llm/models";
import type { Fact, Source } from "../../spec";

export const LIMITS = {
  maxScrapes: () => Number(process.env.MAX_SCRAPES_PER_BUILD ?? 8),
  maxExtract: () => Number(process.env.MAX_EXTRACT_SOURCES ?? 40),
  maxTriage: 120,
  triageConcurrency: 8,
  extractBatch: 4,
  extractConcurrency: 12,
  maxTextChars: 12_000,
  maxPlacesToGeocode: 15,
};

/** How long a board waits before its next scheduled poll, per tier (POLL_HOT_MS and friends override). */
export const POLL_INTERVAL_MS = {
  hot: Number(process.env.POLL_HOT_MS ?? 10 * 60_000),
  warm: Number(process.env.POLL_WARM_MS ?? 30 * 60_000),
  cold: Number(process.env.POLL_COLD_MS ?? 2 * 60 * 60_000),
};

/** Spread into generateText/streamText. */
export const call = (l: Llm) => ({ model: l.model, providerOptions: l.providerOptions });

export function slugify(text: string, max = 48): string {
  const s = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    // NFKD splits Hangul syllables into jamo; recompose them.
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return s || "item";
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function pool<T, O>(items: T[], limit: number, fn: (item: T, i: number) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function sourceLine(s: Source, text: string | null, maxChars: number): string {
  const body = (text ?? [s.title, s.snippet].filter(Boolean).join("\n")).replace(/[ \t]+/g, " ").slice(0, maxChars);
  return `[${s.id}] ${s.publisher ?? hostOf(s.url) ?? ""} | ${s.publishedAt ?? "date unknown"} | ${s.title ?? s.url}\n${s.url}\n${body}`;
}

/**
 * The `n` most recent facts: newest asOf first, undated last, then the newest row. Facts come from the store in id
 * order (oldest first), so a plain slice would feed a long-running board's prompts its oldest facts.
 */
export function newestFacts<T extends Pick<Fact, "id" | "asOf">>(facts: T[], n: number): T[] {
  const t = (f: T) => {
    const ms = f.asOf ? Date.parse(f.asOf) : NaN;
    return Number.isFinite(ms) ? ms : null;
  };
  return [...facts]
    .sort((a, b) => {
      const ta = t(a);
      const tb = t(b);
      if (ta !== tb) {
        if (ta === null) return 1;
        if (tb === null) return -1;
        return tb - ta;
      }
      return b.id - a.id;
    })
    .slice(0, Math.max(0, n));
}

/** One line per fact, cited by fact id, for prompts and decision state. */
export function factLine(f: Fact): string {
  const p = f.payload as unknown as Record<string, unknown>;
  const what =
    f.kind === "metric"
      ? `${f.key} = ${p.valueText}${p.unit ? ` ${p.unit}` : ""}${p.scope ? ` (${p.scope})` : ""}`
      : f.kind === "event"
        ? `${p.title}: ${p.detail}`
        : f.kind === "place"
          ? `${p.name} (${p.placeKind}): ${p.note}`
          : f.kind === "advisory"
            ? `${p.issuer}: ${p.title}. ${p.text}${p.active === false ? " (lifted)" : ""}`
            : f.kind === "resource"
              ? `${p.label} ${p.url}`
              : f.kind === "row"
                ? `${p.table}: ${Object.entries((p.cells as Record<string, string>) ?? {})
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")}`
                : `${p.group}/${p.name}: ${p.state}. ${p.note}`;
  return `[f${f.id}] ${f.kind} ${what} | as of ${f.asOf ?? "unknown"} | ${f.sourceIds.join(",")}`;
}

export function programOf(messages: { role: "user" | "assistant"; content: string }[]): string {
  const user = messages.filter((m) => m.role === "user");
  if (user.length === 0) return "";
  const [first, ...edits] = user;
  return edits.length
    ? `${first.content}\n\nLater instructions from the user (newest last, they override earlier ones):\n${edits.map((m) => `- ${m.content}`).join("\n")}`
    : first.content;
}

export const usageOf = (u: { inputTokens?: number; outputTokens?: number } | undefined | null) => u ?? null;
