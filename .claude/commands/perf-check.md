---
description: Hunt performance problems and memory leaks in a path. Usage - /perf-check <path>
---

Analyse `$ARGUMENTS` for: unbounded Maps/arrays, missing cleanup of listeners/intervals/sockets, re-render storms (context misuse, non-memoised rows, whole-store subscriptions), N+1 Prisma queries, missing indexes, JSON.parse on hot paths, synchronous CPU work in WS handlers, missing virtualisation. For the frontend also run `ANALYZE=true pnpm --filter web build` and report the 10 largest chunks. Give file:line and concrete fixes ranked by impact.
