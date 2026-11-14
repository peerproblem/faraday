# The design system adapter

This folder is the only place that imports `@sw3/ui`. Pages and widgets import from `@/components/ui/*`.
ESLint enforces it (`no-restricted-imports` in `client/eslint.config.mjs`). An upgrade of the design
system is absorbed here, and the rest of the app does not change.

## What is pinned

`client/vendor/SW3_VERSION` names the commit. The tarball next to it is what `npm ci` installs.
Faraday runs sw3 1.0 (Dashboards): `@sw3/ui` 1.0.0, commit `c371d21` of `peerproblem/sw3.0-ui-sdk`, the last
commit of that repository. The SDK is frozen, so fixes Faraday needs are patches in `scripts/sw3-patches/`, which
`scripts/sync-design.sh` applies before it builds the tarball:

- `0001-bridge-content-containers.patch`: in 1.0 Card, DashboardGrid, DashboardSection, AppShell and Collapsible
  register with the agent bridge, and the bridge then hid every Button, SegmentedControl and Input inside them. The
  patch treats them as content containers, like Tabs and Accordion.
- `0002-table-sort-button-name-without-arrow.patch`: a sortable header's bridge label was "Road↕". It is now "Road".

## Upgrading

1. `scripts/sync-design.sh <tag or commit>` from the repository root.
2. Read the SDK's `CHANGELOG.md`, especially "Breaking changes and migration".
3. `cd client && npm run typecheck`. A changed prop or a renamed export shows up here, in this folder.
   Fix it in the adapter file, so callers keep their imports.
4. `npm test`, then `npm run dev` and `npm run e2e` (the sweep covers every page at 1280px and 375px,
   light and dark, and saves screenshots to `e2e/out`). Compare `/dev/ui` and `/dev/fixtures/flood`
   with the screenshots from before the upgrade.

## Files

Every file is a plain re-export of sw3, except these:

| File | What it adds |
| - | - |
| point-map.tsx | Faraday's places on an sw3 MapView. Resolves the MapLibre worker with `new URL(..., import.meta.url)` for Next and passes it as `workerUrl`. Loaded lazily by the map widget |
| meta.ts | `designLimits` from sw3's registry, for code that needs sw3's numeric rules |
| dashboard.ts | The 1.0 dashboard kit: DashboardGrid, DashboardTile, DashboardSection, Breadcrumbs |

## How Faraday uses sw3 v2

v1 lacked several parts, and Faraday filled them with stand-ins and workarounds. v2 ships all of them,
so the stand-ins (and `standins.css`) are gone:

| Need | sw3 v2 part |
| - | - |
| Agents see Buttons and SegmentedControls in Tabs, Accordion, Resizable and ScrollArea | The bridge itself. No `useAgentBinding` wrappers |
| A person confirms an agent's destructive step | `data-sw-confirm=""` on the control and `createAgent({ confirm })` in `components/board/agent-bridge.tsx` |
| Table widget | `Table`, sortable through `TableColumn.compare`, scrolls sideways from the keyboard |
| Source chip on every figure | `CitationChip` |
| Boards that fill in while they are built | `Skeleton` and `EmptyState` |
| Stale figures, degraded services, live boards | `Badge variant="warning"`, `Badge pulse`, `Stat tone`, Timeline `importance="high"` |
| Places by kind | MapView marker kinds (`impact`, `shelter`, `closure`...) and popups |
| Links | `Link` in text, `Card href` for tiles, `Heading as="h1"` for page titles |
| Layering | sw3 ships in the `sw3` layer. `app/globals.css` orders `theme, base, maplibre, sw3, components, utilities` |
| Fonts | `app/tokens.css` sets `--sw-font-sans` and `--sw-font-mono` to the `next/font` variables, which v2 supports |

## How Faraday uses sw3 1.0

- A board is one DashboardGrid (joined, `minTileWidth` 420). Each widget is a DashboardTile: a panel Card whose
  header bar holds the title, the "New" and "Updated" notes and edit tools. Full widgets span 12 columns, half 6.
- Nothing inside a tile draws a second frame (`nested-frame`). Key figures are `Stat size="sm"` cells with a spark
  `TrendChart`; a trend widget is a `TrendChart`.
- TagList is gone in 1.0, and so is its adapter.

## Rules for the rest of the app

- Colours, type sizes and radii come from the design system. Tailwind's own palette, type scale and
  radii are removed in `globals.css`, and its colour names follow the `--sw-*` tokens one to one.
- The accent is sw3's neutral default. Faraday sets no brand accent.
- Tailwind is for layout: grid, flex, gaps, widths, margins.
- No `.sw-*` selector in app CSS.
- Mark any control that changes or deletes someone's board with `data-sw-confirm=""`.
- Board data carries no style. The server still sends `header.accent`; the client ignores it.
