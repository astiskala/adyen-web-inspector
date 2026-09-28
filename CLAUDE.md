# CLAUDE.md

See [AGENTS.md](./AGENTS.md) for full project conventions, architecture, and coding standards.

## Quick Reference

- **Validate**: `pnpm validate` (typecheck → lint → format:check → depcruise → knip → test:coverage → test:integration)
- **Test**: `pnpm test` (unit), `pnpm test:integration` (integration), `pnpm test:e2e` (builds first, then E2E)
- **Build**: `pnpm build`

## Key Rules

- Check modules are pure functions — no `chrome.*` calls, no side effects (lint-enforced).
- Checks read checkout config via `readCheckoutField()` and CSP via `readPagePolicy()`, never the raw slots (lint-enforced).
- The Scan runs through the `ScanBrowser` port; test it with `createFakeScanBrowser()`, not Chrome mocks.
- New captured checkout options go in `readCheckoutOptions()` (`src/shared/checkout-config-schema.ts`).
- Module boundaries and the seams in AGENTS.md → Key Seams are enforced by dependency-cruiser. `shared/` imports nothing outside `shared/`.
- `knip` enforces no unused exports — remove dead code, don't suppress.
- Coverage thresholds (95% lines/functions/statements, 90% branches) are enforced on `src/background/checks/**`, the Scan modules, and the shared evidence, schema, and SDK presence modules.
- Conventional Commits enforced by commitlint. Types: feat, fix, chore, docs, style, refactor, test, ci, build, revert.
- Use `globalThis` instead of `window`.
- CSS Modules with bracket notation for style access.
