import { auth } from "@/auth";
import { BoardGrid } from "@/components/board-grid";
import { PromptForm } from "@/components/prompt-form";
import { SectionIntro } from "@/components/section-intro";
import { Card } from "@/components/ui/card";
import { Caption, Display, Outline, Text } from "@/components/ui/typography";
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
    <>
      <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card padding="lg" radius="xl" className="gap-6">
          <Caption>/software-3.0 for crises</Caption>
          <Display as="h1" size="lg">
            One sentence in. A live <Outline>situation board</Outline> out.
          </Display>
          <Text size="lg" tone="subtle" className="max-w-xl">
            When a flood, fire, blackout or cyberattack hits, the facts are scattered across hundreds of pages that change by the
            minute. Describe the crisis. Faraday reads the live web and builds a board that keeps itself true.
          </Text>
        </Card>
        <PromptForm signedIn={!!session?.user} />
      </section>

      <SectionIntro title="How a sentence becomes a board" lede="Four steps, and the last one never stops." />
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.n} className="min-w-0">
            <Card padding="md" className="h-full gap-3">
              <Caption>{s.n}</Caption>
              <Text className="font-medium">{s.t}</Text>
              <Text size="sm" tone="muted">
                {s.d}
              </Text>
            </Card>
          </li>
        ))}
      </ol>

      <SectionIntro title="Live boards" lede="Every board keeps reading the web while people are watching." />
      <BoardGrid boards={boards} />
    </>
  );
}
