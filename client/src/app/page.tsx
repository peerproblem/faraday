import { BoardGrid } from "@/components/board-grid";
import { PageIntro } from "@/components/page-intro";
import { EmptyTopics, TopicHero, TypeFilter } from "@/components/topic-cards";
import { Heading } from "@/components/ui/typography";
import { SourceWire } from "@/components/sources/source-wire";
import { listTopics, topicSources } from "@/lib/engine";
import { mergeWires } from "@/lib/source-brand";
import { crisisTypes } from "@/lib/spec";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const type = typeof sp.type === "string" && (crisisTypes as readonly string[]).includes(sp.type) ? sp.type : null;
  const topics = await listTopics({ state: "active", type, limit: 25 });
  const sources = await topicSources(topics);
  const wire = mergeWires(Object.values(sources));
  const [top, ...rest] = topics;
  return (
    <>
      <PageIntro
        hero
        eyebrow="/live"
        title="Crises unfolding now"
        lede="Faraday finds them, reads the live web and keeps one shared board per topic true."
      />

      <section aria-labelledby="now" className="flex flex-col gap-4">
        <Heading as="h2" size="sm" id="now">
          Happening now
        </Heading>
        <TypeFilter base="/" active={type} />
        <SourceWire items={wire} label="Reading now" />
        {top ? (
          <>
            <TopicHero topic={top} sources={sources[top.id]} />
            {rest.length ? <BoardGrid boards={rest} sources={sources} /> : null}
          </>
        ) : (
          <EmptyTopics type={type} />
        )}
      </section>
    </>
  );
}
