import { PageIntro } from "@/components/page-intro";
import { P, Prose, ProseHeading } from "@/components/prose";

export const metadata = { title: "Privacy | Faraday" };

export default function Privacy() {
  return (
    <>
      <PageIntro eyebrow="/privacy" title="Privacy policy" lede="Last updated November 14, 2026" />
      <Prose>
        <ProseHeading>What we collect</ProseHeading>
        <P>
          When you sign in with Google we receive your name, email address and profile picture. We store them to keep your
          dashboards. We do not receive your Google password and we do not access any other Google data.
        </P>
        <P>
          We store the layouts of your dashboards and the instructions you type to change them. Shared topic boards are
          public: anyone with the link can view a board and its sources. Your dashboards are only shown to you.
        </P>
        <ProseHeading>How it is used</ProseHeading>
        <P>
          Instructions you type to change a dashboard are sent to our language model provider (Google Gemini). Shared boards are
          built and updated with Google Gemini and our web search provider (Context.dev). We do not sell personal data and we do not use it for advertising.
        </P>
        <ProseHeading>Cookies</ProseHeading>
        <P>We use one session cookie to keep you signed in. There are no tracking cookies.</P>
        <ProseHeading>Deleting your data</ProseHeading>
        <P>
          Write to the team through the GitHub repository at github.com/peerproblem/faraday and we will delete your account and
          dashboards.
        </P>
      </Prose>
    </>
  );
}
