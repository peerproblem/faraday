import { Divider, Heading, Text } from "@/components/ui/typography";

/** The section opening of the design system's layout guide: a rule, a heading, then a lede. */
export function SectionIntro({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="mb-8 mt-16 flex flex-col gap-4 sm:mb-9 sm:mt-24">
      <Divider className="mb-2" />
      <Heading as="h2" size="md">
        {title}
      </Heading>
      {lede ? (
        <Text size="lg" tone="subtle">
          {lede}
        </Text>
      ) : null}
    </div>
  );
}
