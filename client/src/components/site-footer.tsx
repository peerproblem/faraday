import { TextLink } from "@/components/ui/link";
import { Text } from "@/components/ui/typography";
import { SITE_URL } from "@/lib/config";

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 sm:px-6 lg:px-10">
        <Text size="sm" tone="muted">
          Faraday reads the live web through Context.dev.
        </Text>
        <Text as="div" size="sm" tone="muted" className="flex gap-5">
          <TextLink href={`${SITE_URL}/privacy`}>Privacy</TextLink>
          <TextLink href={`${SITE_URL}/terms`}>Terms</TextLink>
          <TextLink href="https://github.com/peerproblem/faraday" external>
            GitHub
          </TextLink>
        </Text>
      </div>
    </footer>
  );
}
