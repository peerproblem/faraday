import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { PageIntro } from "@/components/page-intro";
import { MyDashboards } from "@/components/topic-cards";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Caption, Text } from "@/components/ui/typography";
import { SITE_URL } from "@/lib/config";
import { getMe, listMyViews } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?next=/me");
  const cookie = (await headers()).get("cookie");
  const [me, views] = await Promise.all([getMe(cookie), listMyViews(cookie)]);
  return (
    <>
      <PageIntro eyebrow="/me" title="My dashboards" lede="Your layouts of shared topics. The figures are the shared board's, so they stay current." />
      <MyDashboards views={views} />
      <section aria-labelledby="account" className="mt-12 max-w-md">
        <Card padding="md" className="gap-3">
          <h2 id="account" className="m-0 flex">
            <Caption>Account</Caption>
          </h2>
          <Text>{me?.name ?? session.user.name ?? "Signed in"}</Text>
          <Text size="sm" tone="muted">
            {me?.email ?? session.user.email}
          </Text>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: `${SITE_URL}/` });
            }}
          >
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </Card>
      </section>
    </>
  );
}
