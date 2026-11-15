import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { LiveBoard } from "@/components/board/live-board";
import { AddToDashboard } from "@/components/personal/add-to-dashboard";
import { WorkspaceNavigation } from "@/components/site-header";
import { Link } from "@/components/ui/link";
import { Text } from "@/components/ui/typography";
import { boardSlugFromHost, boardUrl, DOMAIN, SITE_URL } from "@/lib/config";
import { getBoardBySlug, getMyView } from "@/lib/engine";
import { OG_SIZE, ogImagePath } from "@/lib/og";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/b/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const board = await getBoardBySlug(slug).catch(() => null);
  const header = board?.data?.header;
  if (!header) return { title: board?.title ? `${board.title} | live board` : "Faraday board" };
  const title = `${header.title} | live board`;
  const description = header.headline?.text ?? header.subtitle ?? undefined;
  // The link card X, Discord and chat apps show. The image URL changes with each version, so their caches refresh.
  const image = { url: `${SITE_URL}${ogImagePath(slug, board.version)}`, width: OG_SIZE.width, height: OG_SIZE.height, alt: header.title };
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
  const session = board.origin === "system" ? await auth() : null;
  const view = session?.user ? await getMyView(board.id, h.get("cookie")) : null;
  const actions =
    board.origin === "system" ? (
      <AddToDashboard boardId={board.id} slug={board.slug} version={board.version} signedIn={!!session?.user} added={!!view?.layout} />
    ) : undefined;
  if (board.presentation?.workspace === false || (!board.presentation && board.spec?.template === "finance")) {
    return (
      <div className="pt-6">
        <LiveBoard initial={board} actions={actions} />
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
        actions={view?.layout ? undefined : actions}
        workspace
        wildfireOverview={board.id === "1egbu07xcl61"}
        workspaceNavigation={<WorkspaceNavigation dashboardSlug={view?.layout ? board.slug : undefined} />}
      />
    </div>
  );
}
