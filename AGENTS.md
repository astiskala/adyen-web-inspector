# AGENTS.md — Guidance for AI Coding Agents

This file provides context and conventions for AI coding agents (GitHub Copilot, Claude, Cursor, etc.) working on the Adyen Web Inspector codebase.

---

## Project Overview

Adyen Web Inspector is a Chrome Manifest V3 extension that analyses adyen-web (Drop-in / Components) integrations. It consists of a background service worker, content scripts, a popup, and a DevTools panel — all built with TypeScript, Preact, and Vite.

---

## Build & Test Commands

| Command                 | Purpose                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `pnpm install`          | Install dependencies (pnpm 10.33.2 pinned in `package.json`)          |
| `pnpm dev`              | Build in watch mode (`dist/`)                                         |
| `pnpm build`            | Production build                                                      |
| `pnpm typecheck`        | TypeScript type check (`tsc --noEmit`)                                |
| `pnpm lint`             | ESLint + pinned Actions check + Markdown lint                         |
| `pnpm lint:fix`         | ESLint + Markdown lint with auto-fix                                  |
| `pnpm lint:md`          | Markdown lint (`markdownlint-cli2`)                                   |
| `pnpm format`           | Prettier write                                                        |
| `pnpm format:check`     | Prettier check                                                        |
| `pnpm test`             | Unit tests (Vitest)                                                   |
| `pnpm test:coverage`    | Unit tests with V8 coverage                                           |
| `pnpm test:integration` | Integration tests (cross-module pipeline)                             |
| `pnpm test:e2e`         | E2E tests (Playwright + Chromium)                                     |
| `pnpm validate`         | Typecheck, lint, format check, depcruise, knip, coverage, integration |

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

- `--max-warnings=0` enforced on ESLint gate.
- `noInlineConfig: true` on source files (tests are excluded — they may use `eslint-disable` and `@ts-expect-error` with description).
- `@typescript-eslint/ban-ts-comment` blocks `@ts-ignore` and `@ts-nocheck`; `@ts-expect-error` is only allowed in test files with a description.
- `eslint-plugin-import-x` enforces no import cycles and no duplicate imports.
- `eslint-plugin-security` detects runtime hazards (eval, child process, buffer, etc.).
- No nested ternaries — extract to `if`/`else` or helper functions.
- `String#replaceAll()` over regex-based `String#replace()`.
- `element.remove()` over `parent.removeChild(element)`.
- No `document.write()` — use `iframe.srcdoc` instead.
- No `void` operator — use `.catch(() => {})` for fire-and-forget promises.
- `Number.parseInt()` over global `parseInt()`.
- No multiple `Array#push()` calls — use spread: `arr.push(...items)`.
- Functions used as callbacks should be declared at module scope, not inside component render functions.
- `knip` enforces no unused exports; remove dead code instead of suppressing.
- Architecture seams are lint-enforced (see **Key Seams**): checks may not read raw checkout config slots, import CSP parsing primitives (outside `page-policy.ts`), or use `chrome`, `fetch`, `setTimeout`, or `Date.now`; the Scan (`scan-orchestrator.ts`, `scan-assessment.ts`) may not use `chrome`, `fetch`, `setTimeout`, or `Date.now`; popup, DevTools, and the worker may not reference the `'sdk-detected'` check ID.
- Markdown files are linted with `markdownlint-cli2`; JSDoc descriptions must be complete sentences (`jsdoc/require-description-complete-sentence`).

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

| Component                 | Entry                                   | Role                                            |
| ------------------------- | --------------------------------------- | ----------------------------------------------- |
| Background service worker | `src/background/worker.ts`              | Message routing, badge updates, scan dispatch   |
| Scan orchestrator         | `src/background/scan-orchestrator.ts`   | Scan sequencing through the browser port        |
| Scan browser port         | `src/background/scan-browser.ts`        | Port types the Scan needs from the browser      |
| Chrome scan adapter       | `src/background/chrome-scan-browser.ts` | Chrome adapter for the port; stored results     |
| Header collector          | `src/background/header-collector.ts`    | Captures response headers during scans          |
| Check modules             | `src/background/checks/`                | Pure `Check` implementations                    |
| Config interceptor        | `src/content/config-interceptor.ts`     | MAIN-world SDK config capture (CDN + NPM)       |
| Content script            | `src/content/detector.ts`               | Lightweight always-on checkout activity signal  |
| Page extractor            | `src/content/page-extractor.ts`         | MAIN-world extraction of page globals/config    |
| Popup                     | `src/popup/Popup.tsx` → `PopupApp.tsx`  | Quick health summary + scan trigger             |
| DevTools panel            | `src/devtools/panel/`                   | Full inspection UI                              |
| Shared contracts          | `src/shared/types.ts`                   | Core interfaces and types used across layers    |
| Config field schema       | `src/shared/checkout-config-schema.ts`  | Raw options → `CheckoutConfig` for all captures |
| Configuration evidence    | `src/shared/scan-evidence.ts`           | Present / absent / unobserved per config field  |
| SDK presence              | `src/shared/sdk-presence.ts`            | SDK presence verdict stored on `ScanResult`     |
| Finding projection        | `src/shared/export-report.ts`           | Impact grouping for popup, panel, and reports   |

### Key Seams

Each seam names the gate that enforces it.

- **Content-script build**: `vite.config.ts` builds each content script as its own self-contained IIFE after the main build, so content scripts may import from `shared/` without emitting ESM chunk imports. _Build_: fails if a content-script bundle contains `import`/`export` statements.
- **Config field schema**: both capture paths (AdyenCheckout interception and the mounted Preact tree) map raw options through `readCheckoutOptions()` in `src/shared/checkout-config-schema.ts`. Add new captured fields there, never in a capture path. _depcruise_ `config-schema-inline-safe`: the schema may depend on `shared/types.ts` only, because it is inlined into every content script.
- **Configuration evidence**: checks read checkout options with `readCheckoutField()`, which applies source precedence (captured → component → inferred) and the absence rule, and returns `present`, `absent`, or `unobserved`. _ESLint_: checks may not read `checkoutConfig`, `componentConfig`, `inferredConfig`, or `checkoutConfigComplete` directly.
- **Scan browser port**: `runScan(tabId, browser)` takes a `ScanBrowser` (`src/background/scan-browser.ts`). Production passes `chromeScanBrowser`; unit tests use `createFakeScanBrowser()` from `tests/fixtures/fakeScanBrowser.ts` with a virtual clock. _depcruise_ `scan-through-browser-port`, `scan-orchestrator-no-network-probes`, `scan-port-types-only`, `chrome-adapter-wired-by-worker`, `browser-io-behind-chrome-adapter`; _ESLint_: the Scan may not use `chrome`, `fetch`, `setTimeout`, or `Date.now`.
- **SDK presence**: views and the badge read `ScanResult.sdkPresence`; they must not infer it from the `sdk-detected` check's severity. _ESLint_: popup, DevTools, and the worker may not reference `'sdk-detected'`.
- **Page policy**: CSP checks read the enforced policy through `readPagePolicy()` in `src/background/checks/page-policy.ts`; every enforced policy must allow a resource. _ESLint_: other checks may not import `parseCsp`, `cspAllowsUrl`, or `getEffectiveCspSources`.
- **Finding projection**: every issue view groups issues with `groupIssuesByImpact()` and labels them with `IMPACT_LABELS`; flow labels come from `INTEGRATION_FLOW_LABELS`.

### Module Boundaries

Enforced by dependency-cruiser. **Do not violate these:**

- `popup/` → can import from `popup/` and `shared/`
- `devtools/` → can import from `devtools/`, `shared/`, and `popup/components/` (reused UI)
- `content/` → can import from `content/` and `shared/`
- `background/checks/` → can import from `background/checks/` and `shared/`
- `shared/` → no imports from other layers
- `background/scan-{orchestrator,assessment}.ts` → cannot import the Chrome adapter, header collector, npm registry, or worker; the orchestrator also cannot import `payload-builder.ts`
- `background/scan-browser.ts` → can import `shared/types.ts` only
- `background/chrome-scan-browser.ts` → imported only by `background/worker.ts`
- `background/{header-collector,npm-registry}.ts` → imported only by `background/chrome-scan-browser.ts`
- `shared/checkout-config-schema.ts` → can import `shared/types.ts` only

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
  readonly id: CheckId;
  readonly category: CheckCategory;
  run(payload: ScanPayload): CheckResult;
}
```

Check-specific guidance:

- Export grouped arrays (for example `CSP_CHECKS`) from check files; do not export every individual check object.
- Register all new checks in `src/background/checks/index.ts` and add the new ID to `CheckId` in `src/shared/types.ts`.
- Prefer `createRegistry()` context helpers in check runners: `pass()`, `fail()`, `warn()`, `notice()`, `skip()`, `info()`.
- Severity set is: `pass`, `warn`, `fail`, `notice`, `info`, `skip`. Use `notice` for "cannot verify automatically" outcomes.
- Keep `docs/architecture/check-catalog.md` in sync with code changes. `tests/unit/docs/check-catalog.test.ts` enforces check IDs/categories, totals, severities, and notice-list completeness; `tests/unit/docs/documentation.test.ts` checks local Markdown links, documented pnpm commands, README health tiers, and manifest/package version parity. Both run in `pnpm test` and `pnpm validate`.

---

## Testing

### Unit Tests

- Location: `tests/unit/` (subdirectories: `background/`, `checks/`, `content/`, `devtools/`, `popup/`, `shared/`, `docs/`)
- Framework: Vitest with jsdom
- Fixtures: `tests/fixtures/makeScanPayload.ts` — use `makeScanPayload()`, `makeAdyenPayload()`, `makePageExtract()`, `makeCheckoutConfig()`, `makeAdyenMetadata()`, `makeRequest()`, `makeHeader()`, `makeScanResult()`.
- Scan tests: drive `runScan()` through `createFakeScanBrowser()` and `framesOf()` from `tests/fixtures/fakeScanBrowser.ts`; assert on the returned `ScanResult` and the recorded port calls.
- Coverage threshold: **95% lines/functions/statements and 90% branches** on `src/background/checks/**`, `src/background/scan-{assessment,orchestrator}.ts`, and `src/shared/{checkout-config-schema,scan-evidence,sdk-presence}.ts`.

### Integration Tests

- Location: `tests/integration/`
- Framework: Vitest with jsdom (separate config: `vitest.integration.config.ts`)
- Purpose: Cross-module pipeline tests — exercises `ALL_CHECKS → health score → standard compliance` end-to-end.
- Uses the same fixtures as unit tests.

### E2E Tests

- Location: `tests/e2e/`
- Framework: Playwright with Chromium persistent context loading the built extension. Runs headless using the full Chromium build (`channel: 'chromium'`), because the default headless shell cannot load extensions; pass `--headed` (for example `pnpm test:e2e --headed`) to watch the browser.
- Fixture pages: `tests/fixtures/*.html`; `tests/e2e/fixture-server.mjs` serves them on port 4321 and supplies scenario-specific security headers.
- `tests/e2e/scenarios.test.ts` scans offline dummy merchant scenarios using `scanFixture()` from `tests/e2e/fixtures.ts`; external script/API requests are fulfilled locally and the npm version cache is seeded for deterministic results.
- Keep a meaningful browser-result assertion for each registered check ID in `scenarios.test.ts`. Use the optional `duringScan` callback on `scanFixture()` for traffic that must occur during a scan (such as analytics POSTs).
- `tests/e2e/ui.test.ts` checks what the built popup and DevTools panel render. The popup inspects the active tab of its window, so open it with `openPopupFor()`, which adds it as a background tab beside the fixture page. `openDevtoolsPanelFor()` loads the real panel bundle in a tab and stubs only `chrome.devtools.inspectedWindow.tabId`, because Playwright cannot open DevTools panels.
- `dummy-adyen-web.js` simulates both the legacy `checkout.create()` path and v6 `AdyenWeb.Dropin`/`Card` constructors; the fixture server stubs `/api/sessions`, `/api/paymentMethods`, `/api/payments`, and `/api/payments/details` without real Adyen requests or credentials.

---

## macOS Filesystem Note

macOS has a **case-insensitive** filesystem. This means `popup.tsx` and `Popup.tsx` refer to the same file. Entry points and component files must have distinct lowercase names:

- Popup entry: `Popup.tsx` (component: `PopupApp.tsx`)
- Panel entry: `panelEntry.tsx` (component: `Panel.tsx`)

---

## File Organisation Patterns

When adding a new check:

1. Add or extend a file in `src/background/checks/`
2. Read checkout configuration with `readCheckoutField()` and choose a severity for each evidence state (`present`, `absent`, `unobserved`); read CSP with `readPagePolicy()`
3. Register it in the module's exported array and in `index.ts` → `ALL_CHECKS`
4. Add tests in `tests/unit/checks/` covering pass/fail/warn/skip states
5. Update the check registry in `docs/architecture/check-catalog.md`

When capturing a new checkout option:

1. Add the field to `CheckoutConfig` in `src/shared/types.ts`
2. Map it in `readCheckoutOptions()` in `src/shared/checkout-config-schema.ts` (both capture paths pick it up)
3. Add a case to `tests/unit/shared/checkout-config-schema.test.ts`

When adding a new UI component:

1. Create `ComponentName.tsx` and `ComponentName.module.css` in the appropriate folder
2. Use the CSS Modules helper pattern for style access
3. Use Preact hooks from `preact/hooks`

---

## Releasing

To publish a new version:

1. **Bump version in both files** — `package.json` **and** `public/manifest.json` must have the same version. The Chrome Web Store rejects uploads where the manifest version is not greater than the currently published version.
2. **Commit** with message `chore: bump version to X.Y.Z`.
3. **Push** to `main`.
4. **Tag** the commit: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. **CI handles the rest** — the `release` job in `.github/workflows/ci.yml` builds, packages (`pnpm package:chrome`), and creates a GitHub Release with the zip artifact attached.
6. **Update release notes** — CI auto-generates notes, but we replace them with curated bullet points. Use the same style as previous releases (past-tense sentences, one bullet per change, ending with a `**Full Changelog**` link).
7. **Upload to Chrome Web Store** — download the zip from the GitHub Release and upload it via the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

### Common mistakes

- Forgetting to bump `public/manifest.json` — the Chrome Web Store will reject the upload with _"Invalid version number"_.
- Tagging before pushing — if you tag a commit that isn't on `main` yet, the release zip won't include the latest changes.

---

## Docs

- Check catalog: `docs/architecture/check-catalog.md`
- Adyen Web docs: [docs.adyen.com/online-payments](https://docs.adyen.com/online-payments/)
