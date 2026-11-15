import type { User } from "next-auth";
import { cache } from "react";
import { auth, signOut } from "@/auth";
import { LogoMark } from "@/components/logo";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Text } from "@/components/ui/typography";
import { SITE_URL } from "@/lib/config";

const readHeaderSession = cache(async () => auth());

async function signOutFromSite() {
  "use server";
  await signOut({ redirectTo: `${SITE_URL}/` });
}

function SiteLinks({ user, dashboardSlug, compact = false }: { user?: User; dashboardSlug?: string; compact?: boolean }) {
  const dashboardHref = dashboardSlug ? `${SITE_URL}/me/${encodeURIComponent(dashboardSlug)}` : null;
  return (
    <>
      <Button href={`${SITE_URL}/topics`} variant="ghost" size="sm">
        Topics
      </Button>
      {user ? (
        <>
          {dashboardHref && !compact ? (
            <Popover>
              <PopoverTrigger variant="ghost" size="sm" trailing={<Icon name="chevron-down" width={14} height={14} />}>
                My dashboards
              </PopoverTrigger>
              <PopoverContent align="end" padding="sm" aria-label="Dashboard links" className="grid gap-1">
                <Button href={dashboardHref} variant="ghost" size="sm" className="justify-start">
                  Open this dashboard
                </Button>
                <Button href={`${SITE_URL}/me`} variant="ghost" size="sm" className="justify-start">
                  All dashboards
                </Button>
              </PopoverContent>
            </Popover>
          ) : (
            <>
              {dashboardHref && <Button href={dashboardHref} variant="ghost" size="sm">Open this dashboard</Button>}
              <Button href={`${SITE_URL}/me`} variant="ghost" size="sm">My dashboards</Button>
            </>
          )}
          <form action={signOutFromSite} className="flex items-center gap-2 sm:gap-3">
            <Avatar src={user.image ?? undefined} name={user.name ?? user.email ?? "Signed in"} size="sm" />
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </>
      ) : (
        <Button href={`${SITE_URL}/login`} variant="outline" size="sm">
          Sign in
        </Button>
      )}
    </>
  );
}

// On a board subdomain, navigation still goes to the main site.
export async function SiteHeader() {
  const session = await readHeaderSession();
  return (
    <header className="fd-site-header sticky top-0 z-20 border-b border-hairline bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-15 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-10">
        <a href={`${SITE_URL}/`} className="flex items-center gap-2 text-foreground no-underline">
          <LogoMark className="h-6 w-6" />
          <Text as="span">Faraday</Text>
        </a>
        <nav aria-label="Main" className="ml-auto flex items-center gap-1 sm:gap-2">
          <SiteLinks user={session?.user} />
        </nav>
      </div>
    </header>
  );
}

export async function WorkspaceNavigation({ dashboardSlug }: { dashboardSlug?: string }) {
  const session = await readHeaderSession();
  return (
    <nav aria-label="Main" className="shrink-0">
      <div className="hidden items-center gap-2 sm:flex">
        <SiteLinks user={session?.user} dashboardSlug={dashboardSlug} />
      </div>
      <div className="sm:hidden">
        <Popover>
          <PopoverTrigger variant="ghost" size="sm" iconOnly aria-label="Faraday navigation" leading={<Icon name="more" />} />
          <PopoverContent align="end" padding="sm" aria-label="Faraday navigation" className="grid justify-items-start gap-1">
            <SiteLinks user={session?.user} dashboardSlug={dashboardSlug} compact />
          </PopoverContent>
        </Popover>
      </div>
    </nav>
  );
}
