import { redirect } from "next/navigation";
import { auth, demoLoginEnabled, googleEnabled, signIn } from "@/auth";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await auth();
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "/";
  if (session?.user) redirect(next);
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-xl border border-line bg-panel p-6">
      <h1 className="text-xl font-semibold">Sign in to Faraday</h1>
      <p className="mt-1 text-sm text-muted">You need an account to build boards. Anyone can view them.</p>
      <div className="mt-6 grid gap-3">
        {googleEnabled ? (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: next });
            }}
          >
            <button type="submit" className="w-full rounded-lg bg-text px-4 py-2.5 text-sm font-medium text-bg hover:opacity-90">
              Continue with Google
            </button>
          </form>
        ) : null}
        {demoLoginEnabled ? (
          <form
            action={async () => {
              "use server";
              await signIn("demo", { redirectTo: next });
            }}
          >
            <button type="submit" className="w-full rounded-lg border border-line-strong px-4 py-2.5 text-sm hover:border-accent">
              Continue with the demo account
            </button>
          </form>
        ) : null}
        {!googleEnabled ? (
          <p className="text-xs text-faint">Google sign-in turns on when AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are set.</p>
        ) : null}
      </div>
    </div>
  );
}
