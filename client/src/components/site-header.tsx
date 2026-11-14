import Link from "next/link";
import { auth, signOut } from "@/auth";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { SITE_URL } from "@/lib/config";

// Rendered on faraday.watch and on every board subdomain, so links point at the main site.
export async function SiteHeader() {
  const session = await auth();
  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-15 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-10">
        <Link href={`${SITE_URL}/`} className="flex items-center gap-2 font-medium tracking-tight">
          <LogoMark className="h-6 w-6" />
          Faraday
        </Link>
        <nav aria-label="Main" className="ml-auto flex items-center gap-1 sm:gap-2">
          <Button href={`${SITE_URL}/topics`} variant="ghost" size="sm">
            Topics
          </Button>
          {session?.user ? (
            <Button href={`${SITE_URL}/me`} variant="ghost" size="sm">
              My dashboards
            </Button>
          ) : null}
          {session?.user ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: `${SITE_URL}/` });
              }}
              className="flex items-center gap-3"
            >
              <Text as="span" size="sm" tone="muted" className="hidden max-w-40 truncate sm:inline">
                {session.user.name ?? session.user.email}
              </Text>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          ) : (
            <Button href={`${SITE_URL}/login`} variant="outline" size="sm">
              Sign in
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
