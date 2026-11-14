import { NextResponse, type NextRequest } from "next/server";
import { boardSlugFromHost, SITE_URL } from "@/lib/config";

// On the Vultr box this app also serves every published board at <slug>.faraday.watch.
// The board host only has one page: its root. Everything else goes to the main site.
export function proxy(req: NextRequest) {
  const slug = boardSlugFromHost(req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  if (!slug) return;
  const { pathname, search } = req.nextUrl;
  // "/" is rewritten to /b/<slug> in next.config.ts. Server actions on the board page post to "/".
  if (pathname === "/" || pathname.startsWith("/api/auth/")) return;
  return NextResponse.redirect(new URL(pathname + search, SITE_URL));
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|css|js|mjs|map|wasm)$).*)"],
};
