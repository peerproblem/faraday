import { Link } from "@/components/ui/link";
import { Text } from "@/components/ui/typography";
import { SITE_URL } from "@/lib/config";

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 sm:px-6 lg:px-10">
        <Text size="sm" tone="muted">
          Faraday reads the live web through Context.dev.
        </Text>
        <nav aria-label="Site">
          <Text as="div" size="sm" tone="muted" className="flex gap-5">
            <Link href={`${SITE_URL}/privacy`}>Privacy</Link>
            <Link href={`${SITE_URL}/terms`}>Terms</Link>
            <Link href="https://github.com/peerproblem/faraday" target="_blank" rel="noreferrer">
              GitHub
            </Link>
          </Text>
        </nav>
      </div>
    </footer>
  );
}
