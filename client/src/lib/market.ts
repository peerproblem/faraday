// Hourly closes for the indices and stocks a finance board is about, for its price chart. Read on the server
// when the page renders and cached for a few minutes; the board's own collection never sees it.
import "server-only";
import { INDICES, SYMBOL } from "@/lib/market-symbols";

export type MarketLine = {
  symbol: string;
  name: string;
  /** [time in ms, close], oldest first, one per hourly bar. */
  points: [number, number][];
};
export type MarketData = { lines: MarketLine[]; fetchedAt: number };

const MAX_SYMBOLS = 12;
const FRESH_MS = 5 * 60_000;
/** The last read of each symbol, so a busy board page asks for prices at most every few minutes. */
const recent = new Map<string, { at: number; line: Promise<MarketLine | null> }>();

async function line(symbol: string): Promise<MarketLine | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1h`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Faraday board)" }, signal: AbortSignal.timeout(4000), next: { revalidate: 300 } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: { result?: { meta?: { shortName?: string }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const r = json.chart?.result?.[0];
    const close = r?.indicators?.quote?.[0]?.close ?? [];
    const points = (r?.timestamp ?? []).flatMap((t, i): [number, number][] => {
      const c = close[i];
      return typeof c === "number" && Number.isFinite(c) ? [[t * 1000, c]] : [];
    });
    if (points.length < 2) return null;
    const index = INDICES.find((x) => x.symbol === symbol);
    return { symbol, name: index?.name ?? r?.meta?.shortName?.replace(/,? (Inc|Corp|Corporation)\.?$/i, "") ?? symbol, points };
  } catch {
    return null;
  }
}

function cached(symbol: string): Promise<MarketLine | null> {
  const hit = recent.get(symbol);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.line;
  const next = line(symbol);
  recent.set(symbol, { at: Date.now(), line: next });
  return next;
}

/** The indices plus the given stocks. Null when nothing could be read, so the page falls back to reported figures. */
export async function getMarket(stocks: string[]): Promise<MarketData | null> {
  const symbols = [...new Set([...INDICES.map((x) => x.symbol), ...stocks])].filter((s) => SYMBOL.test(s)).slice(0, MAX_SYMBOLS);
  const lines = (await Promise.all(symbols.map(cached))).filter((l): l is MarketLine => l !== null);
  return lines.length ? { lines, fetchedAt: Date.now() } : null;
}
