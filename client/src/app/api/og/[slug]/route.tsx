import { ImageResponse } from "next/og";
import { getBoardBySlug } from "@/lib/engine";
import { LOGO_WAVES } from "@/lib/logo-mark";
import { FALLBACK_CARD, OG_COLORS, OG_SIZE, ogCard, ogTime, type OgCard } from "@/lib/og";

// The share image of a board: what X, Discord and chat apps show under a board link.
// Served from the main site, because a board host only serves its root page.

const { bg: BG, fg: FG, muted: MUTED, panel: PANEL } = OG_COLORS;

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <defs>
        <clipPath id="c">
          <circle cx="32" cy="32" r="28" />
        </clipPath>
      </defs>
      <path clipPath="url(#c)" d={LOGO_WAVES} fill="none" stroke={FG} strokeWidth="3" />
      <circle cx="32" cy="32" r="4.2" fill={FG} />
    </svg>
  );
}

/** Figures are words as often as numbers ("more than 200"), so a long one gets a smaller size instead of a cut. */
const valueSize = (v: string) => (v.length <= 10 ? 40 : v.length <= 16 ? 32 : 26);

function Card({ card }: { card: OgCard }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: BG, color: FG, padding: "56px 64px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Mark size={44} />
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>Faraday</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 22, color: MUTED }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: card.accent }} />
          <div>{card.status ? `Live board, ${card.status}` : "Live board"}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 44, flex: 1 }}>
        <div style={{ fontSize: 24, color: card.accent, textTransform: "uppercase", letterSpacing: 2 }}>{card.kicker}</div>
        <div style={{ fontSize: card.title.length > 44 ? 52 : 62, fontWeight: 700, lineHeight: 1.08, marginTop: 12, letterSpacing: -1.5 }}>{card.title}</div>
        {card.headline ? <div style={{ fontSize: 26, color: MUTED, lineHeight: 1.35, marginTop: 18 }}>{card.headline}</div> : null}
      </div>
      {card.stats.length ? (
        <div style={{ display: "flex", gap: 18, marginTop: 24 }}>
          {card.stats.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", flex: 1, background: PANEL, borderRadius: 16, padding: "18px 22px" }}>
              <div style={{ fontSize: 20, color: MUTED }}>{s.label}</div>
              <div style={{ fontSize: valueSize(s.value), fontWeight: 700, marginTop: 6, lineHeight: 1.1 }}>{s.value}</div>
              {s.delta ? <div style={{ fontSize: 19, color: MUTED, marginTop: 6 }}>{s.delta}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 26, fontSize: 20, color: MUTED }}>
        <div>{`Updated ${ogTime(card.updatedAt)}`}</div>
        <div>Every figure links to its source</div>
      </div>
    </div>
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const board = await getBoardBySlug(slug).catch(() => null);
  const card: OgCard = board?.data ? ogCard(board) : { ...FALLBACK_CARD, updatedAt: Date.now() };
  return new ImageResponse(<Card card={card} />, {
    ...OG_SIZE,
    headers: { "Cache-Control": board?.data ? "public, max-age=300, s-maxage=300, stale-while-revalidate=3600" : "public, max-age=60" },
  });
}
