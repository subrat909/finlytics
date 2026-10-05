---
description: Build a complete app page with all states. Usage - /ui-page <route> <short description>
---

Use the `frontend-engineer` subagent to build the page: $ARGUMENTS

Deliverables: `page.tsx` (server component shell) + `loading.tsx` (shaped skeleton) + `error.tsx` + feature components under `src/features/<feature>/`, empty state, responsive layout, a11y pass (`vitest-axe`), Storybook story for any new shared component, and light/dark screenshots via Playwright (`pnpm --filter web test:visual`). Use only design tokens; no borders/shadows on buttons/inputs.
