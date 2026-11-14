import { notFound } from "next/navigation";
import { fixtureNames, getFixture } from "../../../../../e2e/fixtures";
import { LiveBoard } from "@/components/board/live-board";
import { Studio } from "@/components/studio";

export const dynamic = "force-dynamic";

// Renders saved boards without an engine, for the e2e sweep and for design work. Never in production.
export default async function FixturePage({ params, searchParams }: PageProps<"/dev/fixtures/[name]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { name } = await params;
  const { view } = await searchParams;
  const fx = getFixture(name);
  if (!fx) notFound();
  return (
    <div className="pt-6">
      {view === "studio" ? (
        <Studio initial={fx.board} initialRun={fx.run} canEdit offline />
      ) : (
        <LiveBoard initial={fx.board} live={false} />
      )}
      <p className="mt-6 text-center text-xs text-faint">Fixture boards: {fixtureNames.join(", ")}</p>
    </div>
  );
}
