import { PageIntro } from "@/components/page-intro";
import { P, Prose, ProseHeading } from "@/components/prose";

export const metadata = { title: "Privacy | Faraday" };

export default function Privacy() {
  return (
    <>
      <PageIntro eyebrow="/privacy" title="Privacy policy" lede="Last updated November 15, 2026" />
      <Prose>
        <ProseHeading>What we collect</ProseHeading>
        <P>
          Nothing about you. Faraday has no visitor accounts and no sign-in. Shared topic boards are public: anyone with the
          link can view a board and its sources.
        </P>
        <ProseHeading>How boards are made</ProseHeading>
        <P>
          Shared boards are built and updated with Google Gemini and our web search provider (Context.dev) from public web
          pages. We do not sell data and we do not use it for advertising.
        </P>
        <ProseHeading>Cookies</ProseHeading>
        <P>Visitors get no cookies. Faraday&apos;s admins get one session cookie when they sign in to the admin console. There are no tracking cookies.</P>
        <ProseHeading>Earlier accounts</ProseHeading>
        <P>
          Faraday used to offer Google sign-in for personal dashboards. That is gone, and the accounts and dashboards it stored
          (names, email addresses, profile pictures and layouts) are deleted.
        </P>
      </Prose>
    </>
  );
}
