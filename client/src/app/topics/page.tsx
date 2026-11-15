import { BoardGrid } from "@/components/board-grid";
import { PageIntro } from "@/components/page-intro";
import { TypeFilter } from "@/components/topic-cards";
import { Button } from "@/components/ui/button";
import { listTopics } from "@/lib/engine";
import { crisisTypes } from "@/lib/spec";

export const dynamic = "force-dynamic";

export default async function TopicsPage({ searchParams }: PageProps<"/topics">) {
  const sp = await searchParams;
  const past = sp.state === "archived";
  const type = typeof sp.type === "string" && (crisisTypes as readonly string[]).includes(sp.type) ? sp.type : null;
  const topics = await listTopics({ state: past ? "archived" : "active", type, limit: 100 });
  // Active and Past are two pages, so they are links (sw3: page navigation uses links, not Tabs).
  const list = (label: string, on: boolean, href: string) => (
    <li>
      <Button href={href} size="sm" variant={on ? "secondary" : "ghost"} aria-current={on ? "page" : undefined}>
        {label}
      </Button>
    </li>
  );
  const keep = type ? `?type=${type}` : "";
  return (
    <>
      <PageIntro
        eyebrow="/topics"
        title={past ? "Past topics" : "Topics"}
        lede={past ? "Crises nobody has followed for a while. Their boards stay readable." : "Every crisis Faraday is following, best ranked first."}
      />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav aria-label="Topic lists">
            <ul className="flex gap-1">
              {list("Active", !past, `/topics${keep}`)}
              {list("Past", past, `/topics?state=archived${type ? `&type=${type}` : ""}`)}
            </ul>
          </nav>
          <TypeFilter base="/topics" active={type} extra={past ? "state=archived" : ""} compact />
        </div>
        <BoardGrid
          boards={topics}
          empty={past ? "No past topics" : type ? `No ${type} topics right now` : "No topics yet"}
          emptyDescription={past ? "Topics move here when nobody has followed them for a while." : "Faraday adds topics as crises are detected."}
        />
      </div>
    </>
  );
}
