import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { PageIntro } from "@/components/page-intro";
import { MyDashboards } from "@/components/topic-cards";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Text } from "@/components/ui/typography";
import { SITE_URL } from "@/lib/config";
import { getMe, listMyViews } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?next=/me");
  const cookie = (await headers()).get("cookie");
  const [me, views] = await Promise.all([getMe(cookie), listMyViews(cookie)]);
  const name = me?.name ?? session.user.name ?? "Signed in";
  return (
    <>
      <PageIntro eyebrow="/me" title="My dashboards" lede="Your layouts of shared topics. The figures are the shared board's, so they stay current." />
      <MyDashboards views={views} />
      <section aria-labelledby="account" className="mt-12 max-w-md">
        <Card padding="md">
          <CardHeader>
            <CardTitle as="h2" id="account">
              Account
            </CardTitle>
            <CardDescription>Your dashboards are kept under this account and shown only to you.</CardDescription>
          </CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            <Avatar src={session.user.image ?? undefined} name={name} alt="" size="md" />
            <div className="min-w-0">
              <Text className="truncate">{name}</Text>
              <Text size="sm" tone="muted" className="truncate">
                {me?.email ?? session.user.email}
              </Text>
            </div>
          </div>
          <CardFooter>
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
          </CardFooter>
        </Card>
      </section>
    </>
  );
}
