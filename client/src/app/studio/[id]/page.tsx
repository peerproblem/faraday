import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PageIntro } from "@/components/page-intro";
import { Studio } from "@/components/studio";
import { TextLink } from "@/components/ui/link";
import { getAdminSession, getBoard, getLatestRun } from "@/lib/engine";

export const dynamic = "force-dynamic";

// The admin console for one topic. Everyone else uses the shared board and their own dashboard.
export default async function StudioPage({ params }: PageProps<"/studio/[id]">) {
  const { id } = await params;
  if (!(await getAdminSession((await headers()).get("cookie")))) {
    return (
      <PageIntro
        eyebrow="/studio"
        title="Admins only"
        lede={
          <>
            The studio is where Faraday&apos;s admins run the shared topics. <TextLink href="/admin">Sign in as admin</TextLink>
          </>
        }
      />
    );
  }
  const [board, run] = await Promise.all([getBoard(id), getLatestRun(id)]);
  if (!board) notFound();
  return <Studio initial={board} initialRun={run} canEdit />;
}
