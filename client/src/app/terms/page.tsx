export const metadata = { title: "Terms | Faraday" };

export default function Terms() {
  return (
    <article className="mx-auto max-w-2xl pt-12 text-sm leading-6 text-muted">
      <h1 className="text-2xl font-semibold text-text">Terms of service</h1>
      <p className="mt-2 text-xs text-faint">Last updated November 14, 2026</p>
      <p className="mt-6">
        Faraday is a hackathon project provided as is, without any warranty. Boards are generated automatically from public
        web sources and may be incomplete, outdated or wrong. Do not rely on them for safety decisions. Always follow
        official instructions from emergency services and local authorities.
      </p>
      <p className="mt-4">
        You are responsible for the prompts you write. Do not use Faraday to harass people, spread false information or
        break the law. We may remove boards or accounts that do.
      </p>
      <p className="mt-4">Every board is public. Anyone with its link can view it.</p>
      <p className="mt-4">We may change or stop the service at any time.</p>
    </article>
  );
}
