import { redirect } from "next/navigation";
import { auth, demoLoginEnabled, googleEnabled, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Caption, Heading, Text } from "@/components/ui/typography";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await auth();
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "/";
  if (session?.user) redirect(next);
  return (
    <div className="mx-auto max-w-md pt-8 sm:pt-16">
      <Card padding="lg" radius="xl" className="gap-6">
        <Caption>/sign-in</Caption>
        <div className="flex flex-col gap-3">
          <Heading as="h1" size="lg">
            Sign in to Faraday
          </Heading>
          <Text tone="subtle">Sign in to keep your own dashboards of shared topics. Anyone can view the topics.</Text>
        </div>
        <div className="grid gap-3">
          {googleEnabled ? (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: next });
              }}
            >
              <Button type="submit" size="lg" fullWidth>
                Continue with Google
              </Button>
            </form>
          ) : null}
          {demoLoginEnabled ? (
            <form
              action={async () => {
                "use server";
                await signIn("demo", { redirectTo: next });
              }}
            >
              <Button type="submit" variant="secondary" size="lg" fullWidth>
                Continue with the demo account
              </Button>
            </form>
          ) : null}
          {!googleEnabled ? (
            <Text size="sm" tone="muted">
              Google sign-in turns on when AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are set.
            </Text>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
