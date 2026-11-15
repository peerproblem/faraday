import { PageIntro } from "@/components/page-intro";
import { P, Prose } from "@/components/prose";

export const metadata = { title: "Terms | Faraday" };

export default function Terms() {
  return (
    <>
      <PageIntro eyebrow="/terms" title="Terms of service" lede="Last updated November 14, 2026" />
      <Prose>
        <P>
          Faraday is a hackathon project provided as is, without any warranty. Boards are generated automatically from public
          web sources and may be incomplete, outdated or wrong. Do not rely on them for safety decisions. Always follow
          official instructions from emergency services and local authorities.
        </P>
        <P>Do not use Faraday to harass people, spread false information or break the law.</P>
        <P>Every shared topic board is public. Anyone with its link can view it.</P>
        <P>We may change or stop the service at any time.</P>
      </Prose>
    </>
  );
}
