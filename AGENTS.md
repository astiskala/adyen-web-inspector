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

Keep pnpm settings such as `overrides` and `allowBuilds` in `pnpm-workspace.yaml`. pnpm 10 ignores the `pnpm` field in `package.json`, so a lockfile regenerated with settings there silently drops the security overrides.

---

## Key Conventions

### TypeScript

- **Strict mode** is fully enabled: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `allowUnreachableCode: false`, `allowUnusedLabels: false`, `verbatimModuleSyntax`, `isolatedModules`, `erasableSyntaxOnly`, `noUncheckedSideEffectImports`.
- Use `globalThis` instead of `window`.
- Use `node:` prefix for Node.js built-ins (e.g. `import {resolve} from 'node:path'`).
- Relative imports in `src/` include the `.js` extension (`.css` for stylesheets), even for `.ts`/`.tsx` files; there is no path alias. ESLint enforces this. Tests import `src/` without extensions.
- When a property is `string | undefined` via `exactOptionalPropertyTypes`, use spread to conditionally include it: `...(val === undefined ? {} : {key: val})`.

### Preact / JSX

- `jsxImportSource` is set to `preact` in tsconfig — no manual `import {h}` needed.
- Hooks come from `preact/hooks`.
- CSS Modules are typed as `Record<string, string | undefined>`. Read class names through the shared helper: `const s = cssModule(styles);` (`src/popup/components/css-module.ts`).
- Never use array index as a JSX key — use a stable identifier like `check.id`.

### Linting (gts / ESLint)

- `--max-warnings=0` enforced on ESLint gate.
- On top of gts, ESLint applies the typescript-eslint `strict-type-checked` and `stylistic-type-checked` presets and the `unicorn`, `regexp`, and `sonarjs` recommended presets. The few opted-out rules are listed next to each plugin's rules in `eslint.config.js`; scoped overrides cover the config interceptor, the Vite plugin, and tests.
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
- `Array#toSorted()` over in-place `Array#sort()`.
- Export functions as function declarations, not `export const fn = () => …`.
- Empty functions are allowed only as arrows (for `.catch(() => {})`).
- Functions used as callbacks should be declared at module scope, not inside component render functions.
- Interfaces declare functions as properties (`read: (tabId: number) => Promise<T>`), not methods, so parameter types are checked strictly (`@typescript-eslint/method-signature-style`).
- Functions stay within a cyclomatic complexity of 15 and a nesting depth of 4; split a function rather than raising the limit. Parameters are not reassigned, shadowing is not allowed, and string building uses template literals.
- `knip` enforces no unused exports; remove dead code instead of suppressing. `pnpm knip` also runs `knip --production`, which ignores tests, so an export used only by tests is reported as unused.
- Architecture seams are lint-enforced (see **Key Seams**): checks and the implementation-attribute rules may not read raw checkout config slots; checks may not read `documentHeaders` or import CSP parsing primitives (outside `page-policy.ts`), or use `chrome`, `fetch`, `setTimeout`, or `Date.now`; the Scan (`scan-orchestrator.ts`, `scan-assessment.ts`, `frame-merge.ts`, `captured-traffic.ts`) and the tab state (`tab-state.ts`) may not use `chrome`, `fetch`, `setTimeout`, or `Date.now`; the scan lifecycle hook may not use `chrome`; popup, DevTools, and the worker may not reference the `'sdk-detected'` check ID, or import the implementation-attribute rules, `shared/results.ts`, or the `STORAGE_*` key prefixes.
- Markdown files are linted with `markdownlint-cli2`; JSDoc descriptions must be complete sentences (`jsdoc/require-description-complete-sentence`).

### CSS Modules

- Files use `.module.css` extension.
- Access values through `cssModule(styles)`, which satisfies `noPropertyAccessFromIndexSignature` and gives an empty class for undefined names.

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

| Component                 | Entry                                             | Role                                                     |
| ------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| Background service worker | `src/background/worker.ts`                        | Routes messages and tab events to the tab state          |
| Tab state                 | `src/background/tab-state.ts`                     | Per-tab storage keys, badge, Scan lifecycle, snapshots   |
| Chrome tab state adapter  | `src/background/chrome-tab-state-browser.ts`      | Chrome adapter for the tab state port                    |
| Scan orchestrator         | `src/background/scan-orchestrator.ts`             | Scan sequencing and retries through the browser port     |
| Frame merge               | `src/background/frame-merge.ts`                   | Frame extractions → Checkout page, per-field scope       |
| Captured traffic          | `src/background/captured-traffic.ts`              | Raw network → document headers, requests, analytics      |
| Scan browser port         | `src/background/scan-browser.ts`                  | Port types the Scan needs from the browser               |
| Chrome scan adapter       | `src/background/chrome-scan-browser.ts`           | Chrome adapter for the port; document and script fetches |
| Network recorder          | `src/background/network-recorder.ts`              | Records raw responses and analytics bodies during scans  |
| Check modules             | `src/background/checks/`                          | Pure `Check` implementations                             |
| Page policy               | `src/background/checks/page-policy.ts`            | Document header evidence and the enforced CSP for checks |
| Callback source           | `src/background/checks/callback-source.ts`        | Reads captured onSubmit/beforeSubmit source for checks   |
| Config interceptor        | `src/content/config-interceptor.ts`               | MAIN-world SDK config capture (CDN + NPM)                |
| Content script            | `src/content/detector.ts`                         | Lightweight always-on checkout activity signal           |
| Page extractor            | `src/content/page-extractor.ts`                   | MAIN-world extraction of page globals/config             |
| Popup                     | `src/popup/Popup.tsx` → `PopupApp.tsx`            | Quick health summary + scan trigger                      |
| Scan lifecycle hook       | `src/popup/components/useScanLifecycle.ts`        | Renders a tab snapshot through the tab state client      |
| Chrome tab state client   | `src/popup/components/chrome-tab-state-client.ts` | Chrome adapter for the client: runtime messages          |
| DevTools panel            | `src/devtools/panel/`                             | Full inspection UI                                       |
| Shared contracts          | `src/shared/types.ts`                             | Core interfaces and types used across layers             |
| Adyen endpoint            | `src/shared/adyen-endpoint.ts`                    | What an Adyen URL means: role, environment, region       |
| Capture record            | `src/shared/checkout-capture.ts`                  | How the interceptor accumulates captures in a frame      |
| Config field schema       | `src/shared/checkout-config-schema.ts`            | Raw options → `CheckoutConfig` for all captures          |
| Configuration evidence    | `src/shared/scan-evidence.ts`                     | Present / absent / unobserved per config field           |
| Checkout signals          | `src/shared/checkout-signals.ts`                  | Checkout DOM, frame strength, checkout activity          |
| SDK presence              | `src/shared/sdk-presence.ts`                      | SDK presence verdict stored on `ScanResult`              |
| SDK version               | `src/shared/sdk-version.ts`                       | Version signals, URL/bundle patterns, release dates      |
| Implementation attributes | `src/shared/implementation-attributes.ts`         | Flavor, flow, environment, region; once per scan         |
| Finding projection        | `src/shared/export-report.ts`                     | Issue rows for popup, panel, and reports                 |

### Key Seams

Each seam names the gate that enforces it.

- **Content-script build**: `vite.config.ts` builds each content script as its own self-contained IIFE after the main build, so content scripts may import from `shared/` without emitting ESM chunk imports. _Build_: fails if a content-script bundle contains `import`/`export` statements.
- **Config field schema**: both capture paths (AdyenCheckout interception and the mounted Preact tree) map raw options through `readCheckoutOptions()` in `src/shared/checkout-config-schema.ts`. Add new captured fields there, never in a capture path. _depcruise_ `config-schema-inline-safe`: the schema may depend on `shared/types.ts` only, because it is inlined into every content script.
- **Capture record**: the config interceptor records everything it observes in one frame through `src/shared/checkout-capture.ts`: options captured from AdyenCheckout and component calls with their completeness (`CapturedCheckoutOptions`), values inferred per signal (`adyen-request` or `page-json`), and the initialisation count. It publishes the record on one page global, and the page extractor reads it back with `readCheckoutCapture()`, so "complete but no options" cannot be represented. _depcruise_ `checkout-capture-inline-safe`.
- **Configuration evidence**: `src/shared/scan-evidence.ts` is the only reader of the configuration slots (`capturedConfig`, `componentConfig`, `inferredConfig`, `pageJsonConfig`). Checks read checkout options with `readCheckoutField()`, which applies source precedence (captured → component → inferred from Adyen requests → page JSON) and the absence rule, and returns `present` (with its source and, for inferred values, its signal), `absent`, or `unobserved`. Page-level questions go through `checkoutConfigSources()`, `hasCapturedCheckoutConfig()`, and `hasCompleteCheckoutConfig()`; option-shaped page JSON alone never shows that checkout is configured. _ESLint_: checks and the implementation-attribute rules may not read the configuration slots directly.
- **Scan browser port**: `runScan(tabId, browser)` takes a `ScanBrowser` (`src/background/scan-browser.ts`) and returns the `ScanResult`; the port is I/O only (tab, frames, raw network observations, document and script fetches, npm, clock). The network capture reports raw responses and analytics POST bodies (`ObservedNetwork`); what they mean is the Scan's decision. Production passes `chromeScanBrowser`; unit tests use `createFakeScanBrowser()` from `tests/fixtures/fakeScanBrowser.ts` with a virtual clock, raw network traffic, and in-memory script texts. _depcruise_ `scan-through-browser-port`, `scan-port-types-only`, `chrome-adapter-wired-by-worker`, `browser-io-behind-chrome-adapter`; _ESLint_: the Scan may not use `chrome`, `fetch`, `setTimeout`, or `Date.now`.
- **Captured traffic**: `readCapturedTraffic()` in `src/background/captured-traffic.ts` turns the raw observations into the checkout document's headers, the main-document and Adyen requests checks read (filled in from the page's script tags, links, and Resource Timing), and the SDK fields of analytics bodies. It decides whose headers apply in one place: the tab's own response when checkout runs in the top document, else a fetch of the checkout document's URL, so availability and content always describe the same document (`DocumentHeaders`). _ESLint_: it follows the Scan's no-`chrome`/`fetch`/clock rule.
- **Frame merge**: `mergeFrames()` in `src/background/frame-merge.ts` is the only place that turns frame extractions (`PageExtractResult`) into the Checkout page (`CheckoutPage`). `FIELD_SCOPE` classifies every extraction field as read from the selected frame, merchant frames, or all frames; `CheckoutPage.checkoutInIframe` replaces the per-frame `isInsideIframe`. Frame strength and merchant-frame rules come from the checkout signals. _Types_: `FIELD_SCOPE` satisfies `Record<keyof PageExtractResult, …>`, so a new extraction field does not compile until it is classified; _ESLint_: the frame merge follows the Scan's no-`chrome`/`fetch`/clock rule.
- **Tab state**: `createTabState(browser, scan)` in `src/background/tab-state.ts` owns the per-tab storage keys, the badge, one Scan per page, and discarding a Scan when its tab navigates. Every transition publishes the tab's whole `TabSnapshot` (result, checkout activity, and scan status: idle, running, or failed) as `MSG_TAB_STATE_CHANGED`. It reaches Chrome through `TabStateBrowser`; production passes `chromeTabStateBrowser`, tests use `createFakeTabStateBrowser()` from `tests/fixtures/fakeTabStateBrowser.ts`. _depcruise_ `tab-state-through-port`, `chrome-adapter-wired-by-worker`; _ESLint_: the tab state may not use `chrome`, `fetch`, `setTimeout`, or `Date.now`, and popup, DevTools, and the worker may not import the `STORAGE_*` key prefixes.
- **Tab state client**: the popup and DevTools render a tab through `useScanLifecycle(target, client)`, which reads and follows the tab's snapshots through a `TabStateClient`, never `chrome.storage` or raw runtime messages. The popup and panel roots pass `chromeTabStateClient`; tests connect the real tab state with `connectTabStateClient()` from `tests/fixtures/inMemoryTabStateClient.ts`. _depcruise_ `tab-state-client-wired-by-views`; _ESLint_: the hook may not use `chrome`.
- **SDK version**: `resolveVersionInfo()` in `src/shared/sdk-version.ts` owns version precedence, the Adyen URL and bundle patterns, and the release-date lookup, and records the signal in `VersionInfo.source`. The detector reads versions with `findSdkVersionInUrls()` from the same module. _Tests_: `tests/unit/shared/sdk-version.test.ts` drives every signal through `resolveVersionInfo()`, with bundle text served in memory.
- **Implementation attributes**: `readImplementationAttributes(payload)` derives flavor, flow, environment, region, import method, and checkout activity once per payload. Checks read them from the runner context (`(payload, { attributes }) => …`); views and reports read `ScanResult.attributes` (through `summarizeImplementation()` for display values), never the inference rules. _ESLint_: popup, DevTools, and the worker may not import `shared/implementation-attributes.ts`.
- **SDK presence**: views and the badge read `ScanResult.sdkPresence`; they must not infer it from the `sdk-detected` check's severity. _ESLint_: popup, DevTools, and the worker may not reference `'sdk-detected'`.
- **Page policy**: checks read the checkout document's response headers through `src/background/checks/page-policy.ts`: `readDocumentHeader()` returns `present`, `absent`, or `unavailable`, and `readPagePolicy()` returns the enforced CSP, which every enforced policy must allow a resource under. _ESLint_: other checks may not read `payload.documentHeaders` or import `parseCsp`, `cspAllowsUrl`, or `getEffectiveCspSources`.
- **Adyen endpoint**: `src/shared/adyen-endpoint.ts` is the one reading of Adyen URLs: `readAdyenEndpoint()` returns the role (`cdn`, `checkoutshopper`, `checkout-api`, `analytics`, `other`) and the environment and region the host names, and the module also owns the origins Adyen Web derives from its `environment` option, the Checkout API and translation paths, and the analytics host patterns. Traffic capture, the interceptor, the content scripts, implementation attributes, and checks ask it instead of matching hosts. _depcruise_ `adyen-endpoint-inline-safe`: it may depend on `shared/types.ts` only.
- **Checkout signals**: `src/shared/checkout-signals.ts` is the one definition of checkout activity: the DOM selectors of mounted checkout (`readCheckoutDom()`, `showsMountedCheckout()`), Adyen iframes and merchant documents, frame strength (`checkoutStrength()`, `rendersCheckout()`), and page-level activity (`hasCheckoutActivity()`). The detector and page extractor read the DOM through it, the frame merge ranks frames with it, and implementation attributes decide checkout activity with it. _depcruise_ `checkout-signals-inline-safe`, `evidence-inline-safe`.
- **Callback source**: callback checks read captured onSubmit and beforeSubmit source through `readOnSubmitSource()` and `readSubmissionGuard()` in `src/background/checks/callback-source.ts`, which decide availability (captured config, not Sessions flow, source present) and possible truncation; the checks keep their own severities. _Module_: the source parsers are private, so checks can only use these readings.
- **Finding projection**: every issue view renders `IssueRow`s from `groupIssuesByImpact()` or `buildFindingProjection()` in `src/shared/export-report.ts`; rows carry the impact label, reader-friendly remediation, and a docs link with fallback, so no view sorts or rewords issues (the popup only splits them by severity before grouping). JSON reports flatten the same rows; flow labels come from `INTEGRATION_FLOW_LABELS`. _ESLint_: popup, DevTools, and the worker may not import `shared/results.ts`.
- **Page globals**: `PageGlobalValues` in `src/shared/constants.ts` declares what each `PAGE_GLOBALS` key holds; the config interceptor and page extractor both read and write through it. _Types_: both scripts type their page globals as `PageGlobalValues`.

### Module Boundaries

Enforced by dependency-cruiser. **Do not violate these:**

- `popup/` → can import from `popup/` and `shared/`
- `devtools/` → can import from `devtools/`, `shared/`, and `popup/components/` (reused UI)
- `content/` → can import from `content/` and `shared/`
- `background/checks/` → can import from `background/checks/` and `shared/`
- `shared/` → no imports from other layers
- `background/{scan-orchestrator,scan-assessment,frame-merge,captured-traffic}.ts` → cannot import the Chrome adapters, network recorder, npm registry, worker, or tab state
- `background/tab-state.ts` → cannot import the Chrome adapters, network recorder, npm registry, worker, or the Scan
- `background/scan-browser.ts` → can import `shared/types.ts` only
- `background/chrome-{scan,tab-state}-browser.ts` → imported only by `background/worker.ts`
- `background/{network-recorder,npm-registry}.ts` → imported only by `background/chrome-scan-browser.ts`
- `popup/components/chrome-tab-state-client.ts` → imported only by `popup/PopupApp.tsx` and `devtools/panel/Panel.tsx`
- `shared/{checkout-config-schema,adyen-endpoint}.ts` → can import `shared/types.ts` only
- `shared/{scan-evidence,sdk-presence}.ts` → can import `shared/types.ts` and `shared/adyen-endpoint.ts` only
- `shared/checkout-capture.ts` → can import types, the config field schema, and the Adyen endpoint only
- `shared/checkout-signals.ts` → can import types, the Adyen endpoint, configuration evidence, and SDK presence only

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

- Read implementation attributes (flavor, flow, environment, region, import method, checkout activity) from the runner context, `(payload, { attributes, pass }) => …`, not by re-deriving them from the payload. Use `docsIntegration(attributes)` from `checks/constants.ts` for Drop-in/Components docs links.
- Export grouped arrays (for example `CSP_CHECKS`) from check files; do not export every individual check object.
- Register all new checks in `src/background/checks/index.ts` and add the new ID to `CheckId` in `src/shared/types.ts`.
- Prefer `createRegistry()` context helpers in check runners: `pass()`, `fail()`, `warn()`, `notice()`, `skip()`, `info()`. Destructure them in the runner signature (`(payload, { pass, skip }) => …`).
- Start each check module with a header naming the checks, their category ID, and their scope (see `risk-module.ts`), and declare the category once as `const CATEGORY = '…' as const`.
- Keep static outcome text (titles, details, remediation, docs URLs) in the module's `STRINGS` table. Text that interpolates values stays inline, noted with a `// KEY stays inline (dynamic: …)` comment in the table. Short fragments composed into dynamic text may stay inline.
- Severity set is: `pass`, `warn`, `fail`, `notice`, `info`, `skip`. Use `notice` for "cannot verify automatically" outcomes.
- Keep `docs/architecture/check-catalog.md` in sync with code changes. `tests/unit/docs/check-catalog.test.ts` enforces check IDs/categories, totals, severities, and notice-list completeness; `tests/unit/docs/documentation.test.ts` checks local Markdown links, documented pnpm commands, README health tiers, and manifest/Sonar/package version parity. Both run in `pnpm test` and `pnpm validate`.

---

## Testing

### Unit Tests

- Location: `tests/unit/` (subdirectories: `background/`, `checks/`, `content/`, `devtools/`, `popup/`, `shared/`, `docs/`)
- Framework: Vitest with jsdom
- Fixtures: `tests/fixtures/makeScanPayload.ts` — use `makeScanPayload()`, `makeAdyenPayload()` (complete captured options), `makeCheckoutPage()` (the merged page on a payload), `makePageExtract()` (one frame's extraction), `makeCapturedConfig(options, complete?)`, `makeCheckoutConfig()`, `makeDocumentHeaders(headers?)` and `UNAVAILABLE_DOCUMENT_HEADERS`, `makeAdyenMetadata()`, `makeRequest()`, `makeHeader()`, `makeScanResult()` (derives `attributes` from its payload).
- Scan tests: drive `runScan()` through `createFakeScanBrowser()` and `framesOf()` from `tests/fixtures/fakeScanBrowser.ts`, passing raw network traffic (`network: { responses, posts }`); assert on the returned `ScanResult` and the recorded port calls. Test traffic reading, document headers, and analytics through `runScan()`; test frame selection and field scope with `mergeFrames()` directly.
- Tab state tests: drive `createTabState()` with `createFakeTabStateBrowser()` and a controllable scan function; assert on stored state, badges, and the published snapshots, including navigation while a Scan is pending.
- Scan lifecycle hook tests: connect the real tab state with `connectTabStateClient()` from `tests/fixtures/inMemoryTabStateClient.ts` and render the hook; no `chrome` stubs are needed.
- Page extraction tests: set up the jsdom document and page globals (the capture record on `PAGE_GLOBALS.checkoutCapture`), import `src/content/page-extractor.ts`, and read the `PageExtractResult` it publishes.
- Coverage is **100% lines, statements, branches, and functions for every file in `src/`**, enforced per file (`vitest.config.ts`: `thresholds: { 100: true, perFile: true }`); only declaration-only modules are excluded. Entry points, the service worker, the detector, and the report page have unit tests too. Cover new behaviour with a test through the module's interface; when a branch cannot be reached, remove it rather than excluding it.

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
2. Read checkout configuration with `readCheckoutField()` and choose a severity for each evidence state (`present`, `absent`, `unobserved`); read response headers with `readDocumentHeader()` and CSP with `readPagePolicy()`; read what an Adyen URL means with `readAdyenEndpoint()`; read flavor, flow, environment, and region from the context's `attributes`
3. Register it in the module's exported array and in `index.ts` → `ALL_CHECKS`
4. Add tests in `tests/unit/checks/` covering pass/fail/warn/skip states
5. Update the check registry in `docs/architecture/check-catalog.md`

When capturing a new checkout option:

1. Add the field to `CheckoutConfig` in `src/shared/types.ts`
2. Map it in `readCheckoutOptions()` in `src/shared/checkout-config-schema.ts` (both capture paths pick it up)
3. Add a case to `tests/unit/shared/checkout-config-schema.test.ts`

When adding a new UI component:

1. Create `ComponentName.tsx` and `ComponentName.module.css` in the appropriate folder
2. Read styles through `cssModule(styles)`; avoid inline `style` objects
3. Use Preact hooks from `preact/hooks`
4. For a centered popup state (icon, title, text, optional scan button or link), use `EmptyState`
5. Put copy or colours that also appear in the PDF report in `shared/` (for example `STANDARD_COMPLIANCE_COPY`, `STATUS_COLORS`, `buildRawConfigSections()`)

---

## Releasing

To publish a new version:

1. **Bump the version in all three files** — `package.json`, `public/manifest.json`, and `sonar.projectVersion` in `sonar-project.properties` must match (the documentation tests enforce this). The Chrome Web Store rejects uploads where the manifest version is not greater than the currently published version.
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
