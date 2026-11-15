import { notFound } from "next/navigation";
import { fixtureNames, getFixture } from "../../../../../e2e/fixtures";
import { withSamplePosts } from "../../../../../e2e/fixtures/social-sample";
import { LiveBoard } from "@/components/board/live-board";
import { WorkspaceNavigation } from "@/components/site-header";
import { Studio } from "@/components/studio";
import { Caption } from "@/components/ui/typography";

export const dynamic = "force-dynamic";

// Renders saved boards without an engine, for the e2e sweep and for design work. Never in production.
export default async function FixturePage({ params, searchParams }: PageProps<"/dev/fixtures/[name]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { name } = await params;
  const { view, social } = await searchParams;
  const fx = getFixture(name);
  if (!fx) notFound();
  // ?social=1 adds made-up posts from X, Reddit and others, to see how social sources are drawn.
  if (social) fx.board = withSamplePosts(fx.board);
  return (
    <div className={view === "studio" ? "pt-6" : "contents"}>
      {view === "studio" ? (
        <Studio initial={fx.board} initialRun={fx.run} canEdit offline />
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
