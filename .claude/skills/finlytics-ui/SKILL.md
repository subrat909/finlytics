---
name: finlytics-ui
description: How to build any Finlytics UI component or page — tokens, palette, states, skeletons, patterns. Use whenever writing JSX/TSX in apps/web or packages/ui.
---

# Finlytics UI Skill

## Palette (defined in `packages/ui/src/styles/tokens.css`)
| Token            | Light      | Dark       | Use                                  |
|------------------|------------|------------|--------------------------------------|
| `--primary`      | #4F46E5    | #818CF8    | brand, primary buttons, active nav   |
| `--primary-fg`   | #FFFFFF    | #0B0F19    | text on primary                      |
| `--highlight`    | #0B6B85    | #22D3EE    | highlights, links, chips (was `--accent`; shadcn's `accent` is the hover surface) |
| `--profit`       | #047052    | #34D399    | positive P&L, buy                    |
| `--profit-fg`    | #FFFFFF    | #0B0F19    | text on Buy (profit fill)            |
| `--loss`         | #BE123C    | #FB7185    | negative P&L, sell                   |
| `--loss-fg`      | #FFFFFF    | #0B0F19    | text on Sell (loss fill)             |
| `--warning`      | #A24A06    | #FBBF24    | risk, expiring tokens                |
| `--info`         | #0369A1    | #38BDF8    | informational                        |
| `--violet`       | #7334E0    | #A78BFA    | AI agents                            |
| `--orange`       | #B13C0A    | #FB923C    | brokers                              |
| `--bg`           | #F5F7FA    | #090C12    | page background                      |
| `--surface-1`    | #FFFFFF    | #0F141C    | panels: cards, navbar, sidebar, status bar |
| `--surface-2`    | #F1F4F8    | #171E29    | inputs, secondary buttons            |
| `--surface-3`    | #E4E9F0    | #232C3A    | hover state                          |
| `--fg`           | #0F172A    | #EEF2F6    | primary text                         |
| `--fg-muted`     | #536175    | #A7B1BF    | secondary text                       |
| `--border`       | #D9DFE8    | #283242    | 1px edges of cards, panels, menus    |
| `--border-strong` | #7A8699   | #687589    | input edges (≥ 3:1)                  |
| `--ring`         | primary    | primary    | focus outline (solid, 2px)           |

Category accents for icons/chips: indigo (strategies), cyan (watchlist), emerald (P&L), amber (alerts), rose (risk), violet (AI agents), sky (option chain), orange (brokers).

## Button / Input / Card recipe (no border on buttons, no shadows)
```tsx
// packages/ui/src/components/button.tsx (cva variants)
primary:   "bg-primary text-primary-fg hover:bg-primary/90"
secondary: "bg-surface-2 text-fg hover:bg-surface-3"
ghost:     "bg-transparent hover:bg-surface-2"
profit:    "bg-profit text-profit-fg hover:bg-profit/90"
loss:      "bg-loss text-loss-fg hover:bg-loss/90"
// all: rounded-md h-10 px-4 font-medium transition-[color,background-color] disabled:opacity-50
//      focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid
//      — NO border, NO shadow, no outline-hidden; never transition-colors (it fades the outline in from the text colour)
// input: border border-border-strong bg-surface-2 rounded-md h-10 px-3 placeholder:text-fg-muted aria-invalid:border-loss
//      transition-[color,background-color]
//      focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid
//      — 1px border-strong (≥ 3:1), NO shadow
// card:  rounded-md border border-border bg-surface-1 p-4 sm:p-6 — NO shadow
```

## Page skeleton recipe
```
src/app/(app)/<route>/page.tsx      → async server component: fetch initial data, render <Feature initialData/>
src/app/(app)/<route>/loading.tsx   → <PageLoader variant="..."/>
src/app/(app)/<route>/error.tsx     → <ErrorState onRetry={reset}/>
src/features/<feature>/components/* → client leaves
```

## State components (packages/ui)
Import each from its own module, `@finlytics/ui/components/<name>` (no barrel):
`import { PageLoader } from "@finlytics/ui/components/page-loader"`.
- `<PageLoader variant="dashboard|chart|table|form|chain|calendar"/>`
- `<EmptyState icon={<Icon className="text-highlight"/>} title description action/>`
- `<ErrorState title description onRetry/>`
- `<StaleBadge since={ts}/>` for data older than 5 s
- `<BrokerBanner status="NEEDS_RELOGIN|DISCONNECTED"/>`

## Realtime price cell
```tsx
const tick = useTick(instrumentKey);           // zustand selector, rAF-throttled
<PriceCell value={tick?.ltp} change={tick?.change} />  // tabular-nums, flashes bg-profit/20 or bg-loss/20 for 300ms
```

## Checklist before finishing a UI task
- [ ] tokens only, no hex; no border/shadow on buttons; 1px border token on cards, inputs and surfaces; no shadows
- [ ] loading / empty / error / stale / disconnected states
- [ ] mobile (360px), tablet, desktop
- [ ] keyboard nav, labels, aria-live for live numbers, contrast both themes
- [ ] subscriptions cleaned up; heavy widgets dynamic-imported
- [ ] story + axe test for new shared components
