---
description: Testing and quality gates for all packages.
globs: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**", "**/test_*.py"]
---

# Testing Rules
- Name tests by behaviour: `it("rejects order when kill switch is on")`.
- Arrange-Act-Assert; one behaviour per test; no network in unit tests (use `nock`/`msw`/fixtures).
- Broker adapters: contract tests + recorded fixtures; never hit live broker in CI.
- Critical e2e (Playwright): sign-in, connect broker (mocked OAuth), watchlist add, place paper order, deploy strategy, view P&L.
- Frontend: testing-library + `vitest-axe` for every shared component; visual regression (Storybook + Chromatic/Playwright screenshots) for both themes.
- Coverage gates: api services 80%, broker-sdk 90%, ai-engine core (greeks, indicators, backtest) 90%.
- CI order: lint → typecheck → unit → integration (Testcontainers) → e2e → security scan.
