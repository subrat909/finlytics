---
name: finlytics-ui
description: How to build any Finlytics UI component or page — tokens, palette, states, skeletons, patterns. Use whenever writing JSX/TSX in apps/web or packages/ui.
---

# Finlytics UI Skill

## Palette (defined in `packages/ui/src/styles/tokens.css`)
| Token            | Light      | Dark       | Use                                  |
|------------------|------------|------------|--------------------------------------|
| `--primary`      | #4F46E5    | #818CF8    | brand, primary buttons, active nav   |
| `--accent`       | #06B6D4    | #22D3EE    | highlights, links, chips             |
| `--profit`       | #059669    | #34D399    | positive P&L, buy                    |
| `--loss`         | #E11D48    | #FB7185    | negative P&L, sell                   |
| `--warning`      | #D97706    | #FBBF24    | risk, expiring tokens                |
| `--info`         | #0284C7    | #38BDF8    | informational                        |
| `--bg`           | #F8FAFC    | #0B0F19    | page background                      |
| `--surface-1`    | #FFFFFF    | #111827    | cards                                |
| `--surface-2`    | #F1F5F9    | #1F2937    | inputs, secondary buttons            |
| `--surface-3`    | #E2E8F0    | #374151    | hover state                          |
| `--fg`           | #0F172A    | #F1F5F9    | primary text                         |
| `--fg-muted`     | #64748B    | #9CA3AF    | secondary text                       |
| `--ring`         | primary/60 | primary/60 | focus ring                           |

Category accents for icons/chips: indigo (strategies), cyan (watchlist), emerald (P&L), amber (alerts), rose (risk), violet (AI agents), sky (option chain), orange (brokers).

## Button / Input recipe (no border, no shadow)
```tsx
// packages/ui/src/components/button.tsx (cva variants)
primary:   "bg-primary text-white hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
secondary: "bg-surface-2 text-fg hover:bg-surface-3"
ghost:     "bg-transparent hover:bg-surface-2"
profit:    "bg-profit text-white hover:bg-profit/90"
loss:      "bg-loss text-white hover:bg-loss/90"
// all: rounded-xl h-10 px-4 font-medium transition-colors disabled:opacity-50 — NO border, NO shadow
// input: bg-surface-2 rounded-xl h-10 px-3 focus-visible:ring-2 ring-ring placeholder:text-fg-muted — NO border
```

## Page skeleton recipe
```
src/app/(app)/<route>/page.tsx      → async server component: fetch initial data, render <Feature initialData/>
src/app/(app)/<route>/loading.tsx   → <PageLoader variant="..."/>
src/app/(app)/<route>/error.tsx     → <ErrorState onRetry={reset}/>
src/features/<feature>/components/* → client leaves
```

## State components (packages/ui)
- `<PageLoader variant="dashboard|chart|table|form|chain|calendar"/>`
- `<EmptyState icon={<Icon className="text-accent"/>} title description action/>`
- `<ErrorState title description onRetry/>`
- `<StaleBadge since={ts}/>` for data older than 5 s
- `<BrokerBanner status="NEEDS_RELOGIN|DISCONNECTED"/>`

## Realtime price cell
```tsx
const tick = useTick(instrumentKey);           // zustand selector, rAF-throttled
<PriceCell value={tick?.ltp} change={tick?.change} />  // tabular-nums, flashes bg-profit/20 or bg-loss/20 for 300ms
```

## Checklist before finishing a UI task
- [ ] tokens only, no hex; no border/shadow on buttons & inputs
- [ ] loading / empty / error / stale / disconnected states
- [ ] mobile (360px), tablet, desktop
- [ ] keyboard nav, labels, aria-live for live numbers, contrast both themes
- [ ] subscriptions cleaned up; heavy widgets dynamic-imported
- [ ] story + axe test for new shared components
