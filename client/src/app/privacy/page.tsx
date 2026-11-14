export const metadata = { title: "Privacy | Faraday" };

export default function Privacy() {
  return (
    <article className="mx-auto max-w-2xl pt-12 text-sm leading-6 text-muted">
      <h1 className="text-2xl font-semibold text-text">Privacy policy</h1>
      <p className="mt-2 text-xs text-faint">Last updated November 14, 2026</p>
      <h2 className="mt-8 font-semibold text-text">What we collect</h2>
      <p className="mt-2">
        When you sign in with Google we receive your name, email address and profile picture. We store them to know who
        owns each board. We do not receive your Google password and we do not access any other Google data.
      </p>
      <p className="mt-2">
        We store the prompts you write and the boards built from them. Boards are public: anyone with the link can view a
        board, its prompt and its sources.
      </p>
      <h2 className="mt-8 font-semibold text-text">How it is used</h2>
      <p className="mt-2">
        Prompts are sent to our language model provider (Google Gemini) and our web search provider (Context.dev) to
        build and update boards. We do not sell personal data and we do not use it for advertising.
      </p>
      <h2 className="mt-8 font-semibold text-text">Cookies</h2>
      <p className="mt-2">We use one session cookie to keep you signed in. There are no tracking cookies.</p>
      <h2 className="mt-8 font-semibold text-text">Deleting your data</h2>
      <p className="mt-2">
        Write to the team through the GitHub repository at github.com/peerproblem/faraday and we will delete your account
        and boards.
      </p>
    </article>
  );
}
