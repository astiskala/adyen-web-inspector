# AGENTS.md — Guidance for AI Coding Agents

This file provides context and conventions for AI coding agents (GitHub Copilot, Claude, Cursor, etc.) working on the Adyen Web Inspector codebase.

---

## Project Overview

Adyen Web Inspector is a Chrome Manifest V3 extension that analyses adyen-web (Drop-in / Components) integrations. It consists of a background service worker, content scripts, a popup, and a DevTools panel — all built with TypeScript, Preact, and Vite.

---

## Build & Test Commands

| Command              | Purpose                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `pnpm install`       | Install dependencies                                                    |
| `pnpm dev`           | Build in watch mode (`dist/`)                                           |
| `pnpm build`         | Production build                                                        |
| `pnpm typecheck`     | TypeScript type check (`tsc --noEmit`)                                  |
| `pnpm lint`          | ESLint + Markdown lint                                                  |
| `pnpm lint:fix`      | ESLint + Markdown lint with auto-fix                                    |
| `pnpm lint:md`       | Markdown lint (`markdownlint-cli2`)                                     |
| `pnpm format`        | Prettier write                                                          |
| `pnpm format:check`  | Prettier check                                                          |
| `pnpm test`          | Unit tests (Vitest)                                                     |
| `pnpm test:coverage` | Unit tests with V8 coverage                                             |
| `pnpm test:e2e`      | E2E tests (Playwright + Chromium)                                       |
| `pnpm validate`      | Local quality gate: typecheck + lint + format + depcruise + knip + test |

---

## Key Conventions

### TypeScript

- **Strict mode** is fully enabled: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `allowUnreachableCode: false`, `allowUnusedLabels: false`.
- Use `globalThis` instead of `window`.
- Use `node:` prefix for Node.js built-ins (e.g. `import {resolve} from 'node:path'`).
- When a property is `string | undefined` via `exactOptionalPropertyTypes`, use spread to conditionally include it: `...(val === undefined ? {} : {key: val})`.

### Preact / JSX

- `jsxImportSource` is set to `preact` in tsconfig — no manual `import {h}` needed.
- Hooks come from `preact/hooks`.
- CSS Modules are typed as `{[key: string]: string | undefined}`. Access via a helper: `const s = (key: string) => styles[key] ?? ''`.
- Never use array index as a JSX key — use a stable identifier like `check.id`.

### Linting (gts / ESLint)

- No nested ternaries — extract to `if`/`else` or helper functions.
- `String#replaceAll()` over regex-based `String#replace()`.
- `element.remove()` over `parent.removeChild(element)`.
- No `document.write()` — use `iframe.srcdoc` instead.
- No `void` operator — use `.catch(() => {})` for fire-and-forget promises.
- `Number.parseInt()` over global `parseInt()`.
- No multiple `Array#push()` calls — use spread: `arr.push(...items)`.
- Functions used as callbacks should be declared at module scope, not inside component render functions.
- `knip` enforces no unused exports; remove dead code instead of suppressing.
- Markdown files are linted with `markdownlint-cli2`.

### CSS Modules

- Files use `.module.css` extension.
- Access values with bracket notation or a helper function to satisfy `noPropertyAccessFromIndexSignature`.

### Commit Messages

Conventional Commits enforced by commitlint:

```text
feat: add locale validation check
fix: correct CSP frame-src matching
test: add environment mismatch tests
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `ci`, `build`, `revert`.

---

## Architecture

### Key Runtime Components

| Component                 | Entry                                  | Role                                          |
| ------------------------- | -------------------------------------- | --------------------------------------------- |
| Background service worker | `src/background/worker.ts`             | Message routing, badge updates, scan dispatch |
| Scan orchestrator         | `src/background/scan-orchestrator.ts`  | Coordinates the scan pipeline                 |
| Header collector          | `src/background/header-collector.ts`   | Captures response headers during scans        |
| Check modules             | `src/background/checks/`               | Pure `Check` implementations                  |
| Config interceptor        | `src/content/config-interceptor.ts`    | MAIN-world SDK config capture (CDN + NPM)     |
| Content script            | `src/content/detector.ts`              | Lightweight always-on Adyen detection         |
| Page extractor            | `src/content/page-extractor.ts`        | MAIN-world extraction of page globals/config  |
| Popup                     | `src/popup/Popup.tsx` → `PopupApp.tsx` | Quick health summary + scan trigger           |
| DevTools panel            | `src/devtools/panel/`                  | Full inspection UI                            |
| Shared contracts          | `src/shared/types.ts`                  | Core interfaces and types used across layers  |

### Module Boundaries

Enforced by dependency-cruiser. **Do not violate these:**

- `popup/` → can import from `popup/` and `shared/`
- `devtools/` → can import from `devtools/`, `shared/`, and `popup/components/` (reused UI)
- `content/` → can import from `content/` and `shared/`
- `background/checks/` → can import from `background/checks/` and `shared/`
- `shared/` → no imports from other layers

### Layer Responsibilities

| Layer         | What it does                                         | What it must NOT do                             |
| ------------- | ---------------------------------------------------- | ----------------------------------------------- |
| `shared/`     | Types, constants, pure utility functions             | Import from any other layer                     |
| `content/`    | DOM reading, page-world extraction                   | Access `chrome.storage`, run checks             |
| `background/` | Orchestration, network interception, check execution | Render UI, touch the DOM                        |
| `popup/`      | Quick summary UI                                     | Run checks directly, access `chrome.webRequest` |
| `devtools/`   | Full inspection panel UI                             | Run checks directly, access `chrome.webRequest` |

### Check Modules

Every check in `src/background/checks/` is a **pure function** — synchronous, no side effects, no `chrome.*` API calls:

```typescript
interface Check {
  id: string;
  category: CheckCategory;
  run(payload: ScanPayload): CheckResult;
}
```

Check-specific guidance:

- Export grouped arrays (for example `CSP_CHECKS`) from check files; do not export every individual check object.
- Register all new checks in `src/background/checks/index.ts` and add the new ID to `CheckId` in `src/shared/types.ts`.
- Prefer `createRegistry()` context helpers in check runners: `pass()`, `fail()`, `warn()`, `notice()`, `skip()`, `info()`.
- Severity set is: `pass`, `warn`, `fail`, `notice`, `info`, `skip`. Use `notice` for "cannot verify automatically" outcomes.
- Keep `docs/architecture/check-catalog.md` in sync with code changes. Drift is enforced by `tests/unit/docs/check-catalog.test.ts` (runs in `pnpm test` and `pnpm validate`).

---

## Testing

### Unit Tests

- Location: `tests/unit/` (subdirectories: `checks/`, `content/`, `shared/`, `docs/`)
- Framework: Vitest with jsdom
- Fixtures: `tests/fixtures/makeScanPayload.ts` — use `makeScanPayload()`, `makeAdyenPayload()`, `makePageExtract()`, `makeCheckoutConfig()`, `makeAdyenMetadata()`, `makeRequest()`, `makeHeader()`.
- Coverage threshold: **95% lines/functions/statements and 90% branches** on `src/background/checks/**`.

### E2E Tests

- Location: `tests/e2e/`
- Framework: Playwright with Chromium persistent context loading the built extension
- Fixture pages: `tests/fixtures/*.html`

---

## macOS Filesystem Note

macOS has a **case-insensitive** filesystem. This means `popup.tsx` and `Popup.tsx` refer to the same file. Entry points and component files must have distinct lowercase names:

- Popup entry: `Popup.tsx` (component: `PopupApp.tsx`)
- Panel entry: `panelEntry.tsx` (component: `Panel.tsx`)

---

## File Organisation Patterns

When adding a new check:

1. Add or extend a file in `src/background/checks/`
2. Register it in the module's exported array and in `index.ts` → `ALL_CHECKS`
3. Add tests in `tests/unit/checks/` covering pass/fail/warn/skip states
4. Update the check registry in `docs/architecture/check-catalog.md`

When adding a new UI component:

1. Create `ComponentName.tsx` and `ComponentName.module.css` in the appropriate folder
2. Use the CSS Modules helper pattern for style access
3. Use Preact hooks from `preact/hooks`

---

## Docs

- Check catalog: `docs/architecture/check-catalog.md`
- Adyen Web docs: [docs.adyen.com/online-payments](https://docs.adyen.com/online-payments/)
