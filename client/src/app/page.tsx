import { headers } from "next/headers";
import { auth } from "@/auth";
import { BoardGrid } from "@/components/board-grid";
import { PageIntro } from "@/components/page-intro";
import { EmptyTopics, MyDashboards, TopicHero, TypeFilter } from "@/components/topic-cards";
import { Heading } from "@/components/ui/typography";
import { listMyViews, listTopics } from "@/lib/engine";
import { crisisTypes } from "@/lib/spec";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const type = typeof sp.type === "string" && (crisisTypes as readonly string[]).includes(sp.type) ? sp.type : null;
  const cookie = (await headers()).get("cookie");
  const [session, topics] = await Promise.all([auth(), listTopics({ state: "active", type, limit: 25 })]);
  const views = session?.user ? await listMyViews(cookie) : [];
  const [top, ...rest] = topics;
  return (
    <>
      <PageIntro
        hero
        eyebrow="/live"
        title="Crises unfolding now"
        lede="Faraday finds them, reads the live web and keeps one shared board per topic true. Add a topic to your dashboards to shape it your way."
      />

      {session?.user ? (
        <section aria-labelledby="mine" className="mb-12 flex flex-col gap-4">
          <Heading as="h2" size="sm" id="mine">
            My dashboards
          </Heading>
          <MyDashboards views={views} compact />
        </section>
      ) : null}

      <section aria-labelledby="now" className="flex flex-col gap-4">
        <Heading as="h2" size="sm" id="now">
          Happening now
        </Heading>
        <TypeFilter base="/" active={type} />
        {top ? (
          <>
            <TopicHero topic={top} />
            {rest.length ? <BoardGrid boards={rest} /> : null}
          </>
        ) : (
          <EmptyTopics type={type} />
        )}
      </section>
    </>
  );
}
