import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LiveBoard } from "@/components/board/live-board";
import { boardSlugFromHost, boardUrl, DOMAIN, SITE_URL } from "@/lib/config";
import { getBoardBySlug } from "@/lib/engine";

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
  if (DOMAIN && boardSlugFromHost((await headers()).get("host")) !== slug) redirect(boardUrl(slug));
  const board = await getBoardBySlug(slug);
  if (!board) notFound();
  return (
    <div className="pt-6">
      <LiveBoard initial={board} />
      <p className="mt-8 text-center text-xs text-faint">
        Built by Faraday from one sentence: “{board.prompt}”. Every figure links to its source.{" "}
        <Link href={`${SITE_URL}/`} className="underline">
          Build your own
        </Link>
      </p>
    </div>
  );
}
