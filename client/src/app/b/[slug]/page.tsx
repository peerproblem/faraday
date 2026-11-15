import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LiveBoard } from "@/components/board/live-board";
import { boardSymbols, placedWidgets } from "@/components/finance/finance-data";
import { LiveFinanceBoard } from "@/components/finance/live-finance-board";
import { WorkspaceNavigation } from "@/components/site-header";
import { Link } from "@/components/ui/link";
import { Text } from "@/components/ui/typography";
import { boardSlugFromHost, boardUrl, DOMAIN, SITE_URL } from "@/lib/config";
import { getBoardBySlug } from "@/lib/engine";
import { getMarket } from "@/lib/market";
import { OG_SIZE, ogImagePath } from "@/lib/og";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/b/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const board = await getBoardBySlug(slug).catch(() => null);
  const header = (board?.displaySnapshot?.data ?? board?.data)?.header;
  const boardType = board?.displaySnapshot ? "saved board" : "live board";
  if (!board || !header) return { title: board?.title ? `${board.title} | ${boardType}` : "Faraday board" };
  const title = `${header.title} | ${boardType}`;
  const description = header.headline?.text ?? header.subtitle ?? undefined;
  // The link card X, Discord and chat apps show. The image URL changes with each version, so their caches refresh.
  const image = { url: `${SITE_URL}${ogImagePath(slug, board.displaySnapshot?.version ?? board.version)}`, width: OG_SIZE.width, height: OG_SIZE.height, alt: header.title };
  return {
    title,
    description,
    robots: board?.visibility === "unlisted" ? { index: false } : undefined,
    openGraph: { type: "website", siteName: "Faraday", title, description, url: boardUrl(slug), images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function PublicBoard({ params }: PageProps<"/b/[slug]">) {
  const { slug } = await params;
  // In production boards are only served from their own subdomain.
  const h = await headers();
  if (DOMAIN && boardSlugFromHost(h.get("host")) !== slug) redirect(boardUrl(slug));
  const board = await getBoardBySlug(slug);
  if (!board) notFound();
  if (board.presentation?.marketPrices || (!board.presentation && board.spec?.template === "finance")) {
    // Prices for the indices and whatever the board is about, read here so the chart has more than the reports.
    const market = await getMarket(boardSymbols(placedWidgets(board.spec, board.data), board.data?.header ?? null, board.title));
    return (
      <>
        <LiveFinanceBoard initial={board} market={market} />
        <Text size="sm" tone="muted" className="mt-8 text-center">
          A shared Faraday board, kept current from the live web. Every figure links to its source.{" "}
          <Link href={`${SITE_URL}/topics`}>More topics</Link>
        </Text>
      </>
    );
  }
  if (board.presentation?.workspace === false) {
    return (
      <div className="pt-6">
        <LiveBoard initial={board} />
        <Text size="sm" tone="muted" className="mt-8 text-center">
          A shared Faraday board, kept current from the live web. Every figure links to its source.{" "}
          <Link href={`${SITE_URL}/topics`}>More topics</Link>
        </Text>
      </div>
    );
  }
  return (
    <div className="fd-workspace-shell">
      <LiveBoard
        initial={board}
        workspace
        wildfireOverview={board.id === "1egbu07xcl61"}
        workspaceNavigation={<WorkspaceNavigation />}
      />
    </div>
  );
}
