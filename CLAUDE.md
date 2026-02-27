# CLAUDE.md

See [AGENTS.md](./AGENTS.md) for full project conventions, architecture, and coding standards.

## Quick Reference

- **Validate**: `pnpm validate` (typecheck → lint → format → depcruise → knip → test:coverage)
- **Test**: `pnpm test` (unit), `pnpm test:e2e` (E2E, needs build first)
- **Build**: `pnpm build`

## Key Rules

- Check modules are pure functions — no `chrome.*` calls, no side effects.
- Module boundaries are enforced by dependency-cruiser. `shared/` imports nothing outside `shared/`.
- `knip` enforces no unused exports — remove dead code, don't suppress.
- Coverage thresholds (95% lines/functions/statements, 90% branches) are enforced on `src/background/checks/**`.
- Conventional Commits enforced by commitlint. Types: feat, fix, chore, docs, style, refactor, test, ci, build, revert.
- Use `globalThis` instead of `window`.
- CSS Modules with bracket notation for style access.
