# CLAUDE.md

See [AGENTS.md](./AGENTS.md) for full project conventions, architecture, and coding standards.

## Quick Reference

- **Validate**: `pnpm validate` (typecheck → lint → format:check → depcruise → knip → test:coverage → test:integration)
- **Test**: `pnpm test` (unit), `pnpm test:integration` (integration), `pnpm test:e2e` (builds first, then E2E)
- **Build**: `pnpm build`

## Key Rules

- Check modules are pure functions — no `chrome.*` calls, no side effects (lint-enforced).
- Checks read checkout config via `readCheckoutField()`, response headers via `readDocumentHeader()`, and CSP via `readPagePolicy()`, never the raw slots or `documentHeaders` (lint-enforced), and read flavor, flow, environment, and region from the runner context's `attributes`.
- Read Adyen URLs through `readAdyenEndpoint()` (`shared/adyen-endpoint.ts`) and checkout activity through `shared/checkout-signals.ts`; don't match Adyen hosts or checkout selectors elsewhere.
- The Scan runs through the `ScanBrowser` port, which reports raw network traffic; test it with `createFakeScanBrowser()`, not Chrome mocks. Per-tab state, the badge, and the Scan lifecycle live in `tab-state.ts` behind its own port (`createFakeTabStateBrowser()` in tests), and every change publishes the tab's snapshot; the popup and panel follow it through a `TabStateClient` (`connectTabStateClient()` in tests).
- Views render issue rows from the finding projection (`shared/export-report.ts`) and read `ScanResult.attributes`; they may not import `shared/results.ts`, the implementation-attribute rules, or storage keys (lint-enforced).
- New captured checkout options go in `readCheckoutOptions()` (`src/shared/checkout-config-schema.ts`).
- Module boundaries and the seams in AGENTS.md → Key Seams are enforced by dependency-cruiser. `shared/` imports nothing outside `shared/`.
- `knip` enforces no unused exports (including exports used only by tests, via `knip --production`) — remove dead code, don't suppress.
- Coverage is 100% (lines, statements, branches, functions) for every file in `src/`, enforced per file in `vitest.config.ts`. Test new behaviour through the module's interface; remove unreachable branches instead of excluding them.
- ESLint layers typescript-eslint strict/stylistic type-checked, unicorn, regexp, and sonarjs presets over gts; export functions as declarations and prefer `toSorted()`.
- Conventional Commits enforced by commitlint. Types: feat, fix, chore, docs, style, refactor, test, ci, build, revert.
- Use `globalThis` instead of `window`.
- CSS Modules through the shared helper: `const s = cssModule(styles);`.
