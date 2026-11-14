# Faraday

One sentence in, a live situation board out.

When a flood, fire, blackout or cyberattack hits, the facts are scattered across hundreds of pages that change by the minute. Faraday takes one sentence describing the crisis, reads the live web through [Context.dev](https://context.dev), and builds a situation board that keeps itself up to date. Every figure links to the source it came from.

Built at Junction 2026 for the Context.dev challenge "The Web Is Your Real-Time Database".

## Software 3.0

The sentence is the program. The board is what it compiles to.

1. **Compile.** An LLM turns the sentence into a plan: crisis type, place, news and web queries, the sections the board needs, and a monitor that defines what counts as a change.
2. **Read the web.** Context.dev News Search and Web Search (with highlights) run in parallel and return clean text with URLs.
3. **Compose.** An LLM writes the board as structured data, only from those sources, citing them by id. The partial board streams to the browser while it is written.
4. **Keep watching.** A Context.dev search monitor (semantic, every 10 minutes) and a news poller feed new sources in. A patch step decides what changed, updates the board and writes a change log entry. Off-topic sources are dropped.
5. **Edit the program.** In the studio, an instruction like "add a table of road closures" edits the program and recompiles the board.

Boards are agent-ready: the UI is built on Vercel's [UI SDK](https://github.com/vercel-labs/ui), and each board registers its controls as WebMCP tools.

## Context.dev endpoints used

| Endpoint | Where | Why |
| - | - | - |
| `POST /v1/news/search` | gather, poll | Recent articles for each news query, filtered by date |
| `POST /v1/web/search` with highlights | gather, edit | Official advisories, shelters, status pages, with the passages that answer the query |
| `POST /v1/monitors` (search target, semantic) | watch | Finds new developments every 10 minutes without our own crawler |
| `GET /v1/monitors/{id}/changes`, `POST /v1/monitors/{id}/run` | poll, "Check the web now" | Pull detected changes, or run the monitor on demand |
| `GET /v1/monitors/limits` | watch | Stay inside the account's monitor allowance |
| Webhook `change.detected` | `/api/webhooks/context` | Triggers an update on a public deployment |

## Architecture

```
faraday.watch, www        Vercel   client/  landing, Google sign-in, studio (the builder)
api.faraday.watch         Vultr    server/  engine: build, live updates, MariaDB, SSE, webhooks
<slug>.faraday.watch      Vultr    client/  every published board, one HTTPS certificate each
```

The engine runs for minutes per board, keeps a background worker and holds open streams, so it lives on an always-on box. Caddy fronts it and issues a certificate for a board subdomain only when that board exists. Sign-in happens on faraday.watch; the session cookie is scoped to the whole domain so the engine can tell who is asking.

## Repository

```
client/    Next.js 16 web app (site, studio, board hosting)
server/    engine: Hono API, harness, worker, MariaDB
scripts/   provision.sh, deploy.sh, Caddyfile, systemd units
.env       the only env file, used by both apps, never committed
```

## Run locally

Point DATABASE_URL in .env at a MariaDB, then:

```bash
cd server && npm install && npm run dev   # http://localhost:4000
cd client && npm install && npm run dev   # http://localhost:3000
```

Leave FARADAY_DOMAIN empty locally. Boards are then served at /b/<slug>.

## Deploy

```bash
ssh root@<server> 'bash -s' < scripts/provision.sh   # once: firewall, fail2ban, SSH keys only, MariaDB, Node, Caddy
scripts/deploy.sh                                     # ship, build, restart (keeps the server's own .env)
cd client && vercel --prod                            # the main site
```

## Stack

Next.js 16 (App Router), React 19, Tailwind 4, UI SDK (`@ui-sdk/react`), Hono, AI SDK 7 with Gemini 4 Carbon (OpenAI as a switchable fallback), Context.dev TypeScript SDK, Auth.js (Google), MariaDB, Leaflet with OpenStreetMap tiles, Caddy. Live updates reach the browser over Server-Sent Events.

## Layout

```
server/src/harness/   plan, gather, compose, run (the pipeline and the live update loop)
server/src/           HTTP API, Context.dev client, database, event bus, background worker
client/src/app/       landing, studio/[id] (builder), b/[slug] (published board), login
client/src/components/board   board renderer built from UI SDK components
```

## License

MIT
