import Link from "next/link";
import { BoardGrid } from "@/components/board-grid";
import { PageIntro } from "@/components/page-intro";
import { TypeFilter } from "@/components/topic-cards";
import { listTopics } from "@/lib/engine";
import { crisisTypes } from "@/lib/spec";

export const dynamic = "force-dynamic";

export default async function TopicsPage({ searchParams }: PageProps<"/topics">) {
  const sp = await searchParams;
  const past = sp.state === "archived";
  const type = typeof sp.type === "string" && (crisisTypes as readonly string[]).includes(sp.type) ? sp.type : null;
  const topics = await listTopics({ state: past ? "archived" : "active", type, limit: 100 });
  const tab = (label: string, on: boolean, href: string) => (
    <li>
      <Link
        href={href}
        aria-current={on ? "page" : undefined}
        className={`inline-flex border-b-2 px-1 pb-2 text-sm ${on ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
      >
        {label}
      </Link>
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
      <nav aria-label="Topic lists">
        <ul className="flex gap-6 border-b border-hairline">
          {tab("Active", !past, `/topics${keep}`)}
          {tab("Past", past, `/topics?state=archived${type ? `&type=${type}` : ""}`)}
        </ul>
      </nav>
      <TypeFilter base="/topics" active={type} extra={past ? "state=archived" : ""} />
      <BoardGrid boards={topics} empty={past ? "No past topics." : type ? `No ${type} topics right now.` : "No topics yet."} />
      </div>
    </>
  );
}
