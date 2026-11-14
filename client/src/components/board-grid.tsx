import Link from "next/link";
import { boardUrl } from "@/lib/config";
import type { BoardCard } from "@/lib/engine";
import { ago } from "@/lib/time";

export function BoardGrid({ boards }: { boards: BoardCard[] }) {
  if (!boards.length) return <p className="text-sm text-faint">No boards yet. Build the first one above.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {boards.map((b) => (
        <li key={b.id} data-accent={b.accent ?? "red"}>
          <Link
            href={b.status === "live" ? boardUrl(b.slug) : `/studio/${b.id}`}
            className="flex h-full flex-col rounded-xl border border-line bg-panel p-4 hover:border-accent"
          >
            <div className="flex items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-accent">
                <span className={`h-1.5 w-1.5 rounded-full bg-accent ${b.status === "live" ? "pulse-dot" : ""}`} />
                {b.status === "live" ? "Live" : b.status}
              </span>
              {b.crisisType ? <span className="capitalize text-faint">{b.crisisType}</span> : null}
              <span className="ml-auto text-faint">{ago(b.updatedAt)}</span>
            </div>
            <div className="mt-2 font-medium">{b.title ?? "Untitled board"}</div>
            <p className="mt-1 line-clamp-3 text-sm text-muted">{b.headline ?? b.prompt}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
