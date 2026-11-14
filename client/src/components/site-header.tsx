import { auth, signOut } from "@/auth";
import { LogoMark } from "@/components/logo";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { SITE_URL } from "@/lib/config";

// Rendered on faraday.watch and on every board subdomain, so links point at the main site.
// A small row of site links, so ordinary sw3 Buttons with href (the changelog's advice now that GlassNav is gone).
export async function SiteHeader() {
  const session = await auth();
  const user = session?.user;
  const name = user?.name ?? user?.email ?? "Signed in";
  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-15 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-10">
        <a href={`${SITE_URL}/`} className="flex items-center gap-2 text-foreground no-underline">
          <LogoMark className="h-6 w-6" />
          <Text as="span">Faraday</Text>
        </a>
        <nav aria-label="Main" className="ml-auto flex items-center gap-1 sm:gap-2">
          <Button href={`${SITE_URL}/topics`} variant="ghost" size="sm">
            Topics
          </Button>
          {user ? (
            <Button href={`${SITE_URL}/me`} variant="ghost" size="sm">
              My dashboards
            </Button>
          ) : null}
          {user ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: `${SITE_URL}/` });
              }}
              className="flex items-center gap-2 sm:gap-3"
            >
              <Avatar src={user.image ?? undefined} name={name} size="sm" />
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
