# The design system adapter

This folder is the only place that imports `@sw3/ui`. Pages and widgets import from `@/components/ui/*`.
ESLint enforces it (`no-restricted-imports` in `client/eslint.config.mjs`). An upgrade of the design
system is absorbed here, and the rest of the app does not change.

## What is pinned

`client/vendor/SW3_VERSION` names the commit. The tarball next to it is what `npm ci` installs.
v1 is commit `2e087cc` of `peerproblem/sw3.0-ui-sdk`.

## Upgrading (v1 to v2)

1. `scripts/sync-design.sh <tag or commit>` from the repository root.
2. `cd client && npm run typecheck`. A changed prop or a renamed export shows up here, in this folder.
   Fix it in the adapter file, so callers keep their imports.
3. Go through the stand-ins below. For each part the new version ships, replace the stand-in with the
   real component, keep the adapter's export name and props where possible, and delete its block in
   `standins.css`.
4. `npm test`, then `npm run dev` and `npm run e2e` (the sweep covers every page at 1280px and 375px,
   light and dark, and saves screenshots to `e2e/out`). Compare `/dev/ui` and `/dev/fixtures/flood`
   with the screenshots from before the upgrade.
5. Remove the workarounds below that the new version makes unnecessary.

## Files

| Kind | Files |
| - | - |
| Plain re-exports of sw3 | accordion, alert-dialog, card, charts, field, icon, meter, pagination, popover, provider, resizable, scroll-area, separator, stat, tabs, textarea, timeline, toast, tooltip, typography, waterfall, agent |
| sw3 with a workaround | button.tsx, segmented-control.tsx, point-map.tsx |
| Stand-ins | table.tsx, citation.tsx, skeleton.tsx, link.tsx, link-card.tsx, badge.tsx (warning tone only), standins.css |

## Stand-ins: parts v1 does not have

Each one is marked `data-fd="<name>"` in the DOM and has a block in `standins.css`. They use `--sw-*`
tokens only.

| Stand-in | Used for | Replace with (expected in v2) |
| - | - | - |
| `DataTable` in table.tsx | Table widget | sw3 Table |
| `CitationChip` in citation.tsx | The source chip on every figure. Opens an sw3 Popover | An sw3 chip-sized trigger or citation component |
| `Skeleton`, `Empty` in skeleton.tsx | Boards that fill in while they are built | sw3 Skeleton and empty state |
| `ToneBadge` warning tone in badge.tsx | Stale figures, degraded services, watch-level advisories | A `warning` variant on sw3 Badge |
| `TextLink` in link.tsx | Links in text | An sw3 text link |
| `LinkCard` in link-card.tsx | Board tiles that are real links | `href` on sw3 Card |
| `.fd-live-dot` in standins.css | The pulsing dot of a live board | A live or pulsing dot on sw3 Badge |

## Workarounds for v1 behaviour

| Where | What v1 does | What the adapter does |
| - | - | - |
| button.tsx, segmented-control.tsx, `SortButton` in table.tsx | The agent bridge finds plain buttons and segmented controls only through its DOM fallback, and that fallback skips everything inside Tabs, Accordion, Resizable and ScrollArea. A button in a tab panel is invisible to agents | Registers the control with `useAgentBinding` |
| point-map.tsx | MapView markers have three looks (`default`, `start`, `end`) and no popups. Faraday has six kinds of place | Folds the kinds onto the three looks. The list under the map names each kind in words |
| point-map.tsx, `client/scripts/copy-map-worker.mjs` | MapLibre loads its worker from a file next to its own module. Next moves the module and the map stays blank | Copies the worker to `public/vendor` after install and calls `setWorkerUrl` |
| `components/board/agent-bridge.tsx` | Only the agent can mark a step as needing confirmation. The app cannot mark an element | Asks the person for steps on "Recompile the board", "Delete board" and "Delete forever", by label |
| `app/tokens.css` | sw3 names the Geist family literally | Points `--sw-font-sans` and `--sw-font-mono` at the `next/font` variables |
| `app/globals.css` | The stylesheet has no layer | Imports it into a `sw3` layer under Tailwind's utilities, so a layout class on an sw3 component applies |
| Timeline widget | Items have a progress state, not an importance | Marks major events with an icon in the marker and a "Major" badge |
| Stat tiles | A Stat has no tone for its value | Values are not coloured. Status is shown with badges |

## Rules for the rest of the app

- Colours, type sizes and radii come from the design system. Tailwind's own palette, type scale and
  radii are removed in `globals.css`, and its colour names follow the `--sw-*` tokens one to one.
- Tailwind is for layout: grid, flex, gaps, widths, margins.
- No `.sw-*` selector in app CSS.
- Board data carries no style. The server still sends `header.accent`; the client ignores it.
