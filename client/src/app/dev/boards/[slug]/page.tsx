import { notFound } from "next/navigation";
import { PersonalBoard } from "@/components/personal/personal-board";
import { WorkspaceNavigation } from "@/components/site-header";
import { getBoardBySlug } from "@/lib/engine";
import { emptyLayout } from "@/lib/spec";

export default async function BoardPreview({ params }: PageProps<"/dev/boards/[slug]">) {
  if (process.env.NODE_ENV !== "development") notFound();

  const { slug } = await params;
  const board = await getBoardBySlug(slug);
  if (!board) notFound();

  const hasMap = board.spec?.template !== "finance" && board.spec?.widgets.some((widget) => widget.type === "map");
  return (
    <PersonalBoard
      key={board.id}
      initial={board}
      initialView={{
        rev: 0,
        layout: { ...emptyLayout(board.version), design: hasMap ? "map-overlay" : "standard" },
      }}
      live={false}
      localPreview
      workspaceNavigation={<WorkspaceNavigation />}
    />
  );
}
