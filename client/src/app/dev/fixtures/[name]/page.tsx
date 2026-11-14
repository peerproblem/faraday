import { notFound } from "next/navigation";
import { fixtureNames, getFixture } from "../../../../../e2e/fixtures";
import { LiveBoard } from "@/components/board/live-board";
import { PersonalBoard } from "@/components/personal/personal-board";
import { Studio } from "@/components/studio";
import { emptyLayout, widgetKeyOf } from "@/lib/spec";

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
      ) : view === "mine" ? (
        // A personal dashboard over the fixture: the map pinned, the feed hidden, the first widget half width.
        <PersonalBoard
          initial={fx.board}
          live={false}
          initialView={{
            rev: 1,
            layout: {
              ...emptyLayout(fx.board.version),
              pinned: fx.board.spec?.widgets.some((w) => w.type === "map") ? ["map"] : [],
              hidden: ["feed"],
              size: fx.board.spec?.widgets[0] ? { [widgetKeyOf(fx.board.spec.widgets[0])]: "half" } : {},
            },
          }}
        />
      ) : (
        <LiveBoard initial={fx.board} live={false} />
      )}
      <p className="mt-6 text-center text-xs text-faint">Fixture boards: {fixtureNames.join(", ")}</p>
    </div>
  );
}
