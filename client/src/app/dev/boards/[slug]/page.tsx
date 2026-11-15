import { notFound } from "next/navigation";
import { LiveBoard } from "@/components/board/live-board";
import { WorkspaceNavigation } from "@/components/site-header";
import { getBoardBySlug } from "@/lib/engine";

export default async function BoardPreview({ params }: PageProps<"/dev/boards/[slug]">) {
  if (process.env.NODE_ENV !== "development") notFound();

  const { slug } = await params;
  const board = await getBoardBySlug(slug);
  if (!board) notFound();

  if (board.presentation?.workspace === false || board.spec?.template === "finance") {
    return <div className="pt-6"><LiveBoard key={board.id} initial={board} live={false} /></div>;
  }
  return (
    <div className="fd-workspace-shell">
      <LiveBoard key={board.id} initial={board} live={false} workspace workspaceNavigation={<WorkspaceNavigation />} />
    </div>
  );
}
