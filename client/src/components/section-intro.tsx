import { Divider, Heading, Text } from "@/components/ui/typography";

/** The section opening of the design system's layout guide: a rule, a heading, then a lede. */
export function SectionIntro({ title, lede, level = "h2" }: { title: string; lede?: string; level?: "h2" | "h3" }) {
  return (
    <div className="mb-8 mt-16 flex flex-col gap-4 sm:mb-9 sm:mt-24">
      <Divider className="mb-2" />
      <Heading as={level} size="md">
        {title}
      </Heading>
      {lede ? (
        <Text size="lg" tone="subtle" className="max-w-2xl">
          {lede}
        </Text>
      ) : null}
    </div>
  );
}
