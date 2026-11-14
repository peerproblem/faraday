import { auth } from "@/auth";
import { BoardGrid } from "@/components/board-grid";
import { PromptForm } from "@/components/prompt-form";
import { listBoards } from "@/lib/engine";

export const dynamic = "force-dynamic";

const steps = [
  { n: "01", t: "Compile", d: "Your sentence becomes a plan: what to show, what to search, what counts as a change." },
  { n: "02", t: "Read the web", d: "Context.dev searches news and the web in parallel and returns clean text with sources." },
  { n: "03", t: "Compose", d: "The board is written from those sources only. Every figure links to where it came from." },
  { n: "04", t: "Keep watching", d: "Monitors and news polling feed new sources in. The board updates itself and says what changed." },
];

export default async function Home() {
  const [session, boards] = await Promise.all([auth(), listBoards(9)]);
  return (
    <div className="pt-12 sm:pt-20">
      <section className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#ef4444]">Software 3.0 for crises</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          One sentence in.
          <br />A live situation board out.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted">
          When a flood, fire, blackout or cyberattack hits, the facts are scattered across hundreds of pages that change by the
          minute. Describe the crisis. Faraday reads the live web and builds a board that keeps itself true.
        </p>
      </section>
      <section className="mx-auto mt-10 max-w-3xl">
        <PromptForm signedIn={!!session?.user} />
      </section>
      <section className="mx-auto mt-14 grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <div key={s.n} className="rounded-xl border border-line p-4">
            <div className="font-mono text-xs text-faint">{s.n}</div>
            <div className="mt-1 font-medium">{s.t}</div>
            <p className="mt-1 text-sm text-muted">{s.d}</p>
          </div>
        ))}
      </section>
      <section className="mt-16">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">Live boards</h2>
        <BoardGrid boards={boards} />
      </section>
    </div>
  );
}
