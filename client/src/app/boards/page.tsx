import { BoardGrid } from "@/components/board-grid";
import { PageIntro } from "@/components/page-intro";
import { listBoards } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default async function BoardsPage() {
  const boards = await listBoards(100);
  return (
    <>
      <PageIntro eyebrow="/boards" title="All boards" lede="Every board keeps reading the web while it is live." />
      <BoardGrid boards={boards} />
    </>
  );
}
