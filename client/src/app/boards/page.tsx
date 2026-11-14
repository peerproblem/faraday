import { BoardGrid } from "@/components/board-grid";
import { listBoards } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default async function BoardsPage() {
  const boards = await listBoards(100);
  return (
    <div className="pt-10">
      <h1 className="text-2xl font-semibold tracking-tight">All boards</h1>
      <p className="mt-1 text-sm text-muted">Every board keeps reading the web while it is live.</p>
      <div className="mt-6">
        <BoardGrid boards={boards} />
      </div>
    </div>
  );
}
