import { notFound } from "next/navigation";
import { fixtureNames, getFixture } from "../../../../../e2e/fixtures";
import { withSamplePosts } from "../../../../../e2e/fixtures/social-sample";
import { LiveBoard } from "@/components/board/live-board";
import { PersonalBoard } from "@/components/personal/personal-board";
import { WorkspaceNavigation } from "@/components/site-header";
import { Studio } from "@/components/studio";
import { Caption } from "@/components/ui/typography";
import { emptyLayout, widgetKeyOf } from "@/lib/spec";

export const dynamic = "force-dynamic";

// Renders saved boards without an engine, for the e2e sweep and for design work. Never in production.
export default async function FixturePage({ params, searchParams }: PageProps<"/dev/fixtures/[name]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { name } = await params;
  const { view, social, design } = await searchParams;
  const fx = getFixture(name);
  if (!fx) notFound();
  // ?social=1 adds made-up posts from X, Reddit and others, to see how social sources are drawn.
  if (social) fx.board = withSamplePosts(fx.board);
  return (
    <div className={view === "studio" ? "pt-6" : "contents"}>
      {view === "studio" ? (
        <Studio initial={fx.board} initialRun={fx.run} canEdit offline />
      ) : view === "mine" ? (
        // A personal dashboard over the fixture: the map pinned, the feed hidden, the first widget half width.
        <PersonalBoard
          initial={fx.board}
          live={false}
          workspaceNavigation={<WorkspaceNavigation />}
          initialView={{
            rev: 1,
            layout: {
              ...emptyLayout(fx.board.version),
              design: design === "standard" || design === "map-overlay" ? design : "map-focus",
              pinned: fx.board.spec?.widgets.some((w) => w.type === "map") ? ["map"] : [],
              hidden: ["feed"],
              size: fx.board.spec?.widgets[0] ? { [widgetKeyOf(fx.board.spec.widgets[0])]: "half" } : {},
            },
          }}
        />
      ) : (
        <div className="fd-workspace-shell"><LiveBoard initial={fx.board} live={false} workspace workspaceNavigation={<WorkspaceNavigation />} /></div>
      )}
      {(view === "studio" || social) && <Caption className="fd-fixture-caption mt-6 block text-center">
        Fixture boards: {fixtureNames.join(", ")}
        {social ? ". The social posts on this page are made up." : null}
      </Caption>}
    </div>
  );
}
