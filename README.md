<div align="center">

<img src="client/public/logo.svg" width="88" alt="Faraday logo" />

# Faraday

**One sentence in, a live situation board out.**

[![Live](https://img.shields.io/badge/live-faraday.watch-0b0d10?style=flat-square)](https://faraday.watch)
![Junction 2026](https://img.shields.io/badge/Junction-2026-ff5a36?style=flat-square)
[![Powered by Context.dev](https://img.shields.io/badge/powered%20by-Context.dev-4f46e5?style=flat-square)](https://context.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](LICENSE)

[Try it](https://faraday.watch) &nbsp;|&nbsp; [How it works](#how-it-works) &nbsp;|&nbsp; [Run locally](#run-locally)

</div>

---

When a flood, fire, blackout or cyberattack hits, the facts are scattered across hundreds of pages that change by the minute. Describe the crisis in one sentence. Faraday reads the live web through [Context.dev](https://context.dev), builds a situation board, and keeps it current on its own.

Every figure on the board links to the source it came from.

> Built at Junction 2026 for the Context.dev challenge, "The Web Is Your Real-Time Database", and the "Best Use of Aiven" tech challenge.

## How it works

The sentence is the program. The board is what it compiles to.

```mermaid
flowchart LR
    S([One sentence]) --> P[Plan]
    P --> G[Gather]
    G --> T[Triage]
    T --> E[Extract]
    E --> V{Verify}
    V --> B([Live board])
    M[Monitors] -. new sources .-> G
    B -. keeps watching .-> M
```

| Step | What happens |
| :- | :- |
| **Plan** | An LLM turns the sentence into a plan: crisis type, place, search queries, the questions the board must answer, and what counts as a change. |
| **Gather** | Context.dev news and web search run in parallel, with optional X recent search for local signals. The best web pages are scraped in full; social posts already contain their text. |
| **Triage** | Each source is checked against this specific crisis. Off-topic results are dropped. |
| **Extract** | Facts are pulled out as structured data, each with a verbatim quote from its source. |
| **Verify** | Plain code checks that every quote really exists in the source text. No quote, no fact. |
| **Watch** | Context.dev monitors and a news poller feed new sources back in. The board updates and logs what changed. |

Three rules keep the board honest:

- **No model fills in a widget.** Stats, tables, timelines and the map are assembled from verified facts by pure functions. The written summary may only cite those facts.
- **No model invents a location.** Coordinates come from a geocoder, never from an LLM.
- **Every edit is a program edit.** In the studio, "add a table of road closures" patches the plan and recompiles the board.

Boards are also agent-ready: each one registers its controls as WebMCP tools.

## Context.dev at the core

| API | Used for |
| :- | :- |
| `news.search` | Recent articles for each query, filtered by date |
| `web.search` | Official advisories, shelters and status pages, with highlights |
| `web.scrape` | Full Markdown of the pages worth reading closely |
| `monitors` | Semantic change detection on a search and on official pages, every 30 minutes on hot boards |
| Webhook `change.detected` | Triggers an update the moment a monitor fires |

## Oxylabs for the local view

Global search misses what is only published locally. When a crisis has a place, the geocoder gives its country, and [Oxylabs Web API](https://oxylabs.io/) searches from that country in the local language.

| Endpoint | Used for |
| :- | :- |
| `/v1/search` with `location` | Local-language queries searched from the affected country, at build time and once per poll. Results Context.dev already found are dropped, so what is left is what global search missed. |
| `/v1/scrape` with `location` | Reads the pages that local search found, through the same country. |
| `/v1/scrape` with `run_js` | A second try for pages Context.dev could not read, rendered in a browser. |

Local pages are in the local language, but the board stays in English: non-English sources get an English display title, and their original text never reaches the UI. Quotes are still verified against the original page.

## Architecture

| Host | Runs on | What |
| :- | :- | :- |
| `faraday.watch` | Vercel | Landing, Google sign-in and the studio |
| `api.faraday.watch` | Vultr | Engine API, SSE streams, webhooks and the background worker |
| `<slug>.faraday.watch` | Vultr | Every published board, with its own HTTPS certificate |

```
client/    Next.js 16 app: site, studio, board hosting
server/    Hono API, worker, pipeline graphs, MySQL (Aiven)
scripts/   provision, deploy, Caddyfile, systemd units
```

## Run locally

Put your keys in a single `.env` at the root, set the database variables (see [Database](#database)), then:

```bash
cd server && npm install && npm run dev   # http://localhost:4000, migrates on start
cd client && npm install && npm run dev   # http://localhost:3000
```

X is optional. Set `X_API_BEARER_TOKEN` in the same root `.env` to enable it for newly planned boards. Existing plans without `socialQueries` continue without X. Background X polling runs only for hot boards.

`X_BOARD_DAILY_READ_LIMIT` defaults to 20 and `X_GLOBAL_DAILY_READ_LIMIT` defaults to 100. Each request reserves 10 reads before calling X, including on errors or empty results; counters reset at midnight UTC. Set either limit to 0 to stop live X reads. Invalid limits also stop reads. Reservations and per-board/query `since_id` cursors persist in MySQL (migration 006). Queries combine up to two local keyword/hashtag searches, exclude retweets and replies, and request one page of 10 posts without retries or pagination. A cursor advances after source ingestion succeeds; this deliberately samples the newest posts rather than backfilling a busy search.

Social quotes pass the same quote/number checks as other facts, but appear only in **On the ground (unverified)**. Official/news confirmation must be extracted and verified independently before the information enters figures, tables, timelines, maps, status, advisories or summaries. Social reports cannot overwrite trusted facts or supply numbers to the change log. Each post is shown with its author's display name and @handle, linked to the post on X. See [the X source](server/src/social/x.ts).

Leave `FARADAY_DOMAIN` empty locally and boards are served at `/b/<slug>`.

Deploy with `scripts/deploy.sh` (engine and boards) and `scripts/deploy-site.sh` (main site).

## Sharing boards on X and Discord

Boards reach people where they already are. When a shared topic goes live, or a board makes a material change, the worker posts it to Faraday's X account and to the Discord channels that follow the topic. No model writes these posts: they reuse the board's own title, headline and change note, and the link card shows the board's top figures ([share image](client/src/app/api/og/%5Bslug%5D/route.tsx)).

| Event | X | Discord, channel follows the topic | Discord, channel follows all topics |
| :- | :- | :- | :- |
| Topic goes live | yes | | yes |
| High-importance change | yes | yes | yes |
| Medium-importance change | | yes | |
| Low or silent change | | | |

Limits: at most `X_POST_DAILY_LIMIT` (10) X posts per 24 hours, at least `X_POST_BOARD_GAP_MIN` (180) minutes between X posts about one topic, and `DISCORD_POST_GAP_MIN` (10) minutes per topic per channel. Events older than `DISTRIBUTE_MAX_AGE_MIN` (120) are skipped. Every post is claimed in `outbound_posts` before it is sent, so it never goes out twice. The first run starts after the newest event, so turning distribution on never posts the backlog.

Setup, all in the root `.env`:

- `DISTRIBUTE_ENABLED=1` turns the worker loop on. Posts really go out only while **Post to X and Discord** is on in `/admin` (Sharing). It starts off: until an admin turns it on, the worker only records what it would post (`GET /api/admin/distribution`) and sends nothing, so turning it on never posts the backlog.
- X: `X_API_CONSUMER_KEY`, `X_API_SECRET_KEY`, `X_API_ACCESS_TOKEN` and `X_API_ACCESS_SECRET` of the posting account (OAuth 1.0a user context with read and write permission). The bearer token can only search.
- Discord: create an application, then set `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` and `DISCORD_BOT_TOKEN`. Set the application's Interactions Endpoint URL to `https://api.<domain>/api/webhooks/discord` and run `npm run discord:commands` in `server/` once. Server admins add the bot from `https://api.<domain>/api/discord/install` and use `/follow` in a channel (`/follow` alone follows all topics). Anyone can use `/following` and `/topics`.

## Database

The engine stores everything in a managed Aiven for MySQL 8.4 service (`faraday`, Google Cloud `europe-north2` in Stockholm, Hobbyist plan), next to the Vultr box in Stockholm. Aiven runs the backups, so the server has no local database. The api and worker run the same migrations on start (`npm run migrate` during deploy). Every connection uses TLS and checks the Aiven CA.

| Variable | Value |
| :- | :- |
| `DATABASE_URL` | `mysql://user:password@host:port/faraday?ssl-mode=REQUIRED` |
| `DATABASE_CA` | the Aiven project CA certificate (PEM), base64 encoded on one line |
| `TEST_DATABASE_URL` | the same service with no database path. Tests and evals create and drop their own `faraday_test_*` databases there |

Download the CA from the service overview in the Aiven console (CA certificate), then `base64 < ca.pem | tr -d '\n'`.


## Stack

| Layer | Tech |
| :- | :- |
| Web | Next.js 16, React 19, Tailwind 4, SW3 UI (`@sw3/ui`, our design system, pinned in `client/vendor`) |
| Engine | Hono, AI SDK 7, Aiven for MySQL 8.4, Server-Sent Events |
| Models | Gemini 4 Hydrogen and Carbon, with OpenAI as a switchable fallback |
| Data | Context.dev TypeScript SDK, MapLibre with OpenFreeMap tiles |
| Infra | Vercel, Vultr, Aiven, Caddy with on-demand TLS |

## License

[MIT](LICENSE)
