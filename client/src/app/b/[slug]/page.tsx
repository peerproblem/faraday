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

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/b/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const board = await getBoardBySlug(slug).catch(() => null);
  const header = board?.data?.header;
  if (!header) return { title: board?.title ? `${board.title} | live board` : "Faraday board" };
  return {
    title: `${header.title} | live board`,
    description: header.headline?.text ?? header.subtitle ?? undefined,
    robots: board?.visibility === "unlisted" ? { index: false } : undefined,
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
  // Finance boards have no map to centre a workspace on, so they keep the card grid.
  if (board.spec?.template === "finance") {
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
        workspaceNavigation={<WorkspaceNavigation dashboardSlug={view?.layout ? board.slug : undefined} />}
      />
    </div>
  );
}
