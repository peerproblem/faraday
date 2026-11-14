import Link from "next/link";
import { auth, signOut } from "@/auth";
import { SITE_URL } from "@/lib/config";

// Rendered on faraday.watch and on every board subdomain, so links point at the main site.
export async function SiteHeader() {
  const session = await auth();
  return (
    <header className="sticky top-0 z-[1100] border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href={`${SITE_URL}/`} className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[#ef4444] text-[11px] font-bold text-white">F</span>
          Faraday
        </Link>
        <nav className="ml-auto flex items-center gap-4 text-sm text-muted">
          <Link href={`${SITE_URL}/boards`} className="hover:text-text">
            Boards
          </Link>
          {session?.user ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: `${SITE_URL}/` });
              }}
              className="flex items-center gap-3"
            >
              <span className="hidden max-w-[160px] truncate sm:inline">{session.user.name ?? session.user.email}</span>
              <button type="submit" className="rounded-md border border-line-strong px-2.5 py-1 text-xs hover:text-text">
                Sign out
              </button>
            </form>
          ) : (
            <Link href={`${SITE_URL}/login`} className="rounded-md border border-line-strong px-2.5 py-1 text-xs hover:text-text">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
