import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { Studio } from "@/components/studio";
import { getBoard } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: PageProps<"/studio/[id]">) {
  const { id } = await params;
  const [board, session] = await Promise.all([getBoard(id), auth()]);
  if (!board) notFound();
  return <Studio initial={board} canEdit={!!session?.user?.id && session.user.id === board.ownerId} />;
}
