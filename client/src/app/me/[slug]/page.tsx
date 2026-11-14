import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { PersonalBoard } from "@/components/personal/personal-board";
import { getBoardBySlug, getMyView } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/me/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const board = await getBoardBySlug(slug).catch(() => null);
  return { title: `${board?.data?.header?.title ?? board?.title ?? "Topic"} | my dashboard`, robots: { index: false } };
}

export default async function MyDashboardPage({ params }: PageProps<"/me/[slug]">) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?next=${encodeURIComponent(`/me/${slug}`)}`);
  const board = await getBoardBySlug(slug);
  if (!board) notFound();
  const view = await getMyView(board.id, (await headers()).get("cookie"));
  return (
    <div className="pt-6">
      <PersonalBoard initial={board} initialView={view} />
    </div>
  );
}
