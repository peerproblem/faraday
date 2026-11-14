import { redirect } from "next/navigation";

// Boards are shared topics now.
export default function BoardsPage() {
  redirect("/topics");
}
