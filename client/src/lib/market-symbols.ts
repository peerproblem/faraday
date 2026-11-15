// Which market symbols a finance board's figures and companies stand for. Shared by the server read and the page.

/** The US benchmarks every finance board gets, with the volatility index for the fear gauge. */
export const INDICES = [
  { symbol: "^GSPC", name: "S&P 500", match: /s&p|sp ?500/i },
  { symbol: "^DJI", name: "Dow Jones", match: /\bdow\b/i },
  { symbol: "^IXIC", name: "Nasdaq", match: /nasdaq/i },
  { symbol: "^VIX", name: "VIX", match: /\bvix\b|volatility/i },
] as const;
export const VIX = "^VIX";

/**
 * Markets a finance board may be about besides Wall Street, picked up when its title, headline or figures name
 * them: the currencies and the index behind the other finance topics (Egypt, Paraguay, France).
 */
export const ASSETS = [
  { symbol: "EGP=X", name: "USD/EGP", match: /\begypt(ian)?\b|\begp\b/i },
  { symbol: "PYG=X", name: "USD/PYG", match: /\bparaguay(an)?\b|\bguaran[ií]\b|\bpyg\b/i },
  { symbol: "^FCHI", name: "CAC 40", match: /\bfrench\b|\bfrance\b|\bcac\b/i },
  { symbol: "EURUSD=X", name: "EUR/USD", match: /\bfrench\b|\bfrance\b|\beuro\b|\beurozone\b/i },
] as const;

/** The assets a piece of text names, in list order. */
export const assetsIn = (text: string) => ASSETS.filter((a) => a.match.test(text)).map((a) => a.symbol);

export const SYMBOL = /^\^?[A-Z0-9.=-]{1,12}$/;

/** Big listed names a table may give without a ticker. */
const KNOWN: Record<string, string> = {
  nvidia: "NVDA", microsoft: "MSFT", apple: "AAPL", alphabet: "GOOGL", google: "GOOGL", amazon: "AMZN", meta: "META",
  tesla: "TSLA", broadcom: "AVGO", "advanced micro devices": "AMD", amd: "AMD", micron: "MU", oracle: "ORCL",
  palantir: "PLTR", tsmc: "TSM", "taiwan semiconductor": "TSM", intel: "INTC", coreweave: "CRWV", arm: "ARM",
  "super micro": "SMCI", supermicro: "SMCI", qualcomm: "QCOM", salesforce: "CRM", netflix: "NFLX",
};

/** A company's ticker: the one the table gives, else a known name. */
export function tickerOf(name: string, ticker: string | null): string | null {
  if (ticker && SYMBOL.test(ticker)) return ticker;
  const n = name.toLowerCase();
  const hit = Object.keys(KNOWN).find((k) => new RegExp(`\\b${k}\\b`).test(n));
  return hit ? KNOWN[hit] : null;
}

/** The index a figure is about ("S&P 500 Change" → ^GSPC), if any. */
export const indexOfLabel = (label: string) => INDICES.find((x) => x.match.test(label))?.symbol ?? null;
