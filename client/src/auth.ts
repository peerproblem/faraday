import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DOMAIN } from "@/lib/config";
import { registerUser } from "@/lib/engine";

export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
export const demoLoginEnabled = !googleEnabled || process.env.ALLOW_DEMO_LOGIN === "1";

const providers: NextAuthConfig["providers"] = [];
if (googleEnabled) providers.push(Google);
if (demoLoginEnabled) {
  providers.push(
    Credentials({
      id: "demo",
      name: "Demo account",
      credentials: {},
      authorize: async () => ({ id: "demo", email: "demo@faraday.local", name: "Demo responder", image: null }),
    }),
  );
}

// In production the session cookie is shared by faraday.watch, its board subdomains and
// api.faraday.watch, so the engine can read who is signed in.
const cookies: NextAuthConfig["cookies"] = DOMAIN
  ? {
      sessionToken: {
        name: "__Secure-authjs.session-token",
        options: { domain: `.${DOMAIN}`, httpOnly: true, sameSite: "lax", path: "/", secure: true },
      },
    }
  : undefined;

function sameFamily(url: URL) {
  return DOMAIN !== "" && (url.hostname === DOMAIN || url.hostname.endsWith(`.${DOMAIN}`));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  trustHost: true,
  cookies,
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) {
        token.uid = await registerUser({ email: user.email, name: user.name ?? null, image: user.image ?? null });
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
    redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        const u = new URL(url);
        if (u.origin === baseUrl || sameFamily(u)) return url;
      } catch {}
      return baseUrl;
    },
  },
});
