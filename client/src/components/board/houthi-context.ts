import type { Source, TimelineData } from "@/lib/spec";
import { toMs } from "@/lib/time";

// Board-specific reporting retrieved through Context.dev on Nov 15. Use the stated
// event or announcement day for replay, and label reports whose event date is unknown.
const fetchedAt = Date.parse("2026-11-15T04:53:29Z");
const news = (id: string, publisher: string, url: string, title: string, publishedAt: string): Source => ({
  id, publisher, url, title, publishedAt, fetchedAt,
  kind: "news", sourceType: "news", via: "contextdev", relevance: null, snippet: null,
});

export const houthiContextSources = [
  news("ctx1", "Reuters · The Hindu",
    "https://www.thehindu.com/news/international/saudi-arabia-warns-of-potential-danger-in-yanbu-oil-hub-as-houthi-attacks-continue/article71671139.ece",
    "Saudi Arabia warns of potential danger in Yanbu oil hub as Houthi attacks continue", "2026-11-05T16:12:06Z"),
  news("ctx2", "Arab News",
    "https://www.arabnews.com/saudi-arabia/saudi-defenses-intercept-houthi-ballistic-missile-targeting-eastern-province-3010424",
    "Aramco building in Riyadh targeted, Saudi energy ministry says", "2026-11-08T03:26:09.050Z"),
  news("ctx3", "Outlook India",
    "https://www.outlookindia.com/international/india-evacuates-19-seafarers-stranded-yemen-hodeidah-sanaa-red-sea",
    "India evacuates 19 seafarers stranded in Yemen for two weeks", "2026-11-09T02:32:03Z"),
  news("ctx4", "Reuters · The Express Tribune",
    "https://tribune.com.pk/story/2639565/saudi-led-coalition-reports-houthi-missile-drone-interceptions-saba-reports-saudi-strikes-on-sanaa",
    "Saudi-led coalition reports Houthi missile, drone interceptions; Saba reports Saudi strikes on Sanaa", "2026-11-10T06:22:04Z"),
];

type Item = TimelineData["items"][number];

function report(id: string, date: string, title: string, detail: string, source: string, quote: string, importance: Item["importance"] = "medium"): Item {
  return { id: `context-${id}`, asOf: date, at: date, title, detail, sources: [source], evidence: { source, quote }, importance };
}

const additions: { item: Item; match: (text: string) => boolean; replaceUndated?: boolean }[] = [
  {
    item: report("yanbu-warning", "2026-11-05", "Saudi authorities issue a warning for Yanbu",
      "Reuters reported that Saudi authorities warned of potential danger in the Red Sea oil export hub of Yanbu.", "ctx1",
      "warning of potential danger in Yanbu"),
    match: (text) => /yanbu/i.test(text) && /warn|alert/i.test(text),
  },
  {
    item: report("najran-interceptions", "2026-11-06", "Coalition reports two missile interceptions near Najran",
      "Arab News reported that two ballistic missiles targeting Najran were intercepted. Debris fell and authorities were assessing possible damage.", "ctx2",
      "two ballistic missiles targeting Najran were intercepted"),
    match: (text) => /najran/i.test(text) && /intercept/i.test(text),
  },
  {
    item: report("seafarers-evacuated", "2026-11-08", "India announces evacuation of 19 seafarers from Yemen",
      "India’s embassy said the seafarers had been stranded in Hodeidah and Sana’a. It reported that all 19 were in good health and travelling home.", "ctx3",
      "all the seafarers were in good health and had begun their journey back to India"),
    match: (text) => /seafarer/i.test(text) && /evacuat/i.test(text) && /\b19\b/.test(text),
  },
  {
    item: report("saudi-interceptions", "2026-11-10", "Coalition reports further missile and drone interceptions",
      "The coalition said it intercepted missiles fired toward Riyadh and southern Saudi Arabia, and a drone over the Eastern Province.", "ctx4",
      "destroyed a ballistic missile and a cruise missile fired towards the Saudi capital", "high"),
    match: (text) => /riyadh/i.test(text) && /intercept/i.test(text) && /missile/i.test(text),
  },
  {
    item: report("sanaa-strikes-reported", "2026-11-10", "Saba reports strikes on energy sites in Sana’a",
      "On Nov 10, Reuters relayed the Houthi-run agency’s report of strikes on a gas facility and a state oil company building in Sana’a. Saudi authorities had not immediately confirmed the strikes.", "ctx4",
      "Saudi authorities did not immediately confirm the reported strikes", "high"),
    match: (text) => /sana[’'‘]?a/i.test(text) && /oil company|al[- ]mufazir/i.test(text),
    replaceUndated: true,
  },
];

export function houthiTimeline(timeline?: TimelineData): TimelineData {
  const existing = timeline?.items ?? [];
  const replaced = new Set<string>();
  const extra: Item[] = [];

  for (const { item, match, replaceUndated } of additions) {
    const matching = existing.filter(({ title, detail }) => match(`${title} ${detail}`));
    if (matching.some(({ at }) => at && (replaceUndated || at.slice(0, 10) === item.at))) continue;
    const merged = replaceUndated ? matching.filter(({ at }) => !at) : [];
    for (const { id } of merged) replaced.add(id);
    extra.push({ ...item, sources: [...new Set([...item.sources, ...merged.flatMap(({ sources }) => sources)])] });
  }

  const items = [...existing.filter(({ id }) => !replaced.has(id)), ...extra];
  items.sort((a, b) => (toMs(b.at) ?? -Infinity) - (toMs(a.at) ?? -Infinity));
  return { items };
}
