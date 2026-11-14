import type { BoardView, Source, Widget } from "../../src/lib/spec";

// Made-up posts for design work on how social sources look (platform marks, handles, the on-the-ground cards).
// Every account name starts with "sample": none of this was said by anyone. Added by /dev/fixtures/<name>?social=1.
const HOUR = 3_600_000;

const posts: { id: string; url: string; publisher: string; title: string; text: string; hoursAgo: number; original?: string }[] = [
  {
    id: "x1",
    url: "https://x.com/sample_tenants_mad/status/1900000000000000101",
    publisher: "@sample_tenants_mad",
    title: "@sample_tenants_mad",
    text: "Gran Via is full from Callao to Plaza de Espana. Police line at Cibeles, the march is moving slowly but it is calm so far.",
    original: "La Gran Via esta llena desde Callao hasta Plaza de Espana. Cordon policial en Cibeles, la marcha avanza despacio pero con calma por ahora.",
    hoursAgo: 1,
  },
  {
    id: "x2",
    url: "https://x.com/sample_bcn_transit/status/1900000000000000102",
    publisher: "@sample_bcn_transit",
    title: "@sample_bcn_transit",
    text: "Metro L3 is running every 12 minutes under minimum services. The Sants concourse is closed, use the Paisos Catalans entrance.",
    hoursAgo: 2,
  },
  {
    id: "x3",
    url: "https://www.reddit.com/r/sample_spain/comments/1abcde/general_strike_megathread/",
    publisher: "r/sample_spain",
    title: "General strike megathread: what is open and what is running",
    text: "Supermarket near Atocha closed at 14:00. Cercanias C-4 only every 30 minutes, check the operator's page before you travel.",
    original: "El supermercado junto a Atocha ha cerrado a las 14:00. Cercanias C-4 solo cada 30 minutos, mirad la web del operador antes de viajar.",
    hoursAgo: 3,
  },
  {
    id: "x4",
    url: "https://t.me/sample_strike_info/4821",
    publisher: "Sample strike info",
    title: "Sample strike info",
    text: "The assembly point for the Valencia march moved to Plaza San Agustin because of roadworks. Start time is unchanged, 18:30.",
    hoursAgo: 4,
  },
  {
    id: "x5",
    url: "https://bsky.app/profile/sample-reporter.bsky.social/post/3kabcdefgh2x",
    publisher: "Sample reporter",
    title: "Sample reporter",
    text: "Seville: pickets at the Mercasevilla gates since 5am, lorries are being turned back. No incidents reported at this hour.",
    hoursAgo: 6,
  },
  {
    id: "x6",
    url: "https://www.youtube.com/@sample_streetcam/live",
    publisher: "Sample street cam",
    title: "Live: Puerta del Sol during the general strike",
    text: "Live camera over Puerta del Sol. The square filled around 19:00 and the crowd reaches down Calle Mayor.",
    hoursAgo: 7,
  },
];

/** The board with the sample posts as social sources and an on-the-ground widget that quotes them. */
export function withSamplePosts(board: BoardView, now = Date.now()): BoardView {
  if (!board.spec || !board.data) return board;
  const social: Source[] = posts.map((p) => ({
    id: p.id,
    url: p.url,
    title: p.title,
    publisher: p.publisher,
    kind: "social",
    publishedAt: new Date(now - p.hoursAgo * HOUR).toISOString(),
    fetchedAt: now - 5 * 60_000,
    // As the engine sends it: the words of a post in another language never leave the server as a snippet.
    snippet: p.original ? null : p.text,
    relevance: 0.8,
    sourceType: "social",
    via: p.url.startsWith("https://x.com/") ? "x" : null,
  }));
  const widget: Widget = { id: "on-the-ground", key: "on-the-ground", type: "on-the-ground", title: "On the ground (unverified)", span: "full", bind: null, metrics: [] };
  const rest = board.spec.widgets.filter((w) => w.type !== "on-the-ground");
  const at = Math.max(0, rest.findIndex((w) => w.type === "narrative")) + 1;
  return {
    ...board,
    sources: [...social, ...board.sources],
    spec: { ...board.spec, widgets: [...rest.slice(0, at), widget, ...rest.slice(at)] },
    data: {
      ...board.data,
      hidden: board.data.hidden.filter((id) => id !== widget.id),
      widgets: {
        ...board.data.widgets,
        [widget.id]: {
          items: posts.map((p, i) => ({
            id: `social-${p.id}`,
            quote: p.text,
            sources: [p.id],
            asOf: social[i].publishedAt,
            evidence: { source: p.id, quote: p.text, ...(p.original ? { original: p.original } : {}) },
          })),
        },
      },
    },
  };
}
