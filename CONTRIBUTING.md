# Contributing to Adyen Web Inspector

Thank you for your interest in contributing! This guide will help you get set up and explain the conventions used in this project.

---

## Prerequisites

- **Node.js** ≥ 24
- **pnpm** 10.33.2 (pinned in `package.json`)
- **Chrome** (or Chromium) for manual testing and E2E tests

## Setup

```bash
git clone <your-fork-or-origin-url>
cd adyen-web-inspector
pnpm install
```

This will also install Git hooks via Husky.

---

## Development Workflow

### 1. Create a branch

```bash
git checkout -b feat/your-feature
```

### 2. Develop

```bash
pnpm dev    # Vite watch mode → dist/
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions` (Developer mode on).

### 3. Validate before committing

```bash
pnpm validate
```

This runs (in order): `typecheck` → `lint` → `format:check` → `depcruise` → `knip` → `test:coverage` → `test:integration`.
`lint` includes ESLint, a pinned-GitHub-Actions check, and Markdown linting. Documentation consistency tests run with the unit tests in `test:coverage`.

### 4. Commit

This project enforces [Conventional Commits](https://www.conventionalcommits.org/) via commitlint.

```text
feat: add new check for locale validation
fix: correct CSP frame-src domain matching
test: add missing environment mismatch cases
docs: update README with export instructions
chore: bump vitest to 3.1
refactor: extract score calculation into shared utility
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `ci`, `build`, `revert`.

The subject must be lower-case and the header must not exceed 100 characters.

### 5. Push & open a PR

CI will run all validation steps automatically.

---

## Code Style

This project uses [gts](https://github.com/google/gts) (Google TypeScript Style) as an ESLint/TypeScript baseline, with the typescript-eslint strict and stylistic type-checked presets, the `unicorn`, `regexp`, and `sonarjs` recommended presets, additional project rules, and a separate Prettier configuration.

Key conventions:

- **TypeScript strict mode** — `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `erasableSyntaxOnly`.
- **Prefer `globalThis`** over `window` for globals.
- **Use `node:` prefix** for Node.js built-in imports (e.g. `import {resolve} from 'node:path'`).
- **CSS Modules** — read class names through the shared helper, `const s = cssModule(styles);` (`src/popup/components/css-module.ts`), which satisfies `noPropertyAccessFromIndexSignature`.
- **No nested ternaries** — use `if`/`else` or extract helper functions.
- **`String#replaceAll()`** over regex-based `String#replace()`.
- **`element.remove()`** over `parent.removeChild(element)`.
- **`Array#toSorted()`** over in-place `Array#sort()`.
- **Function declarations for exports** — not `export const fn = () => …`.
- **Preact** — use `jsxImportSource: preact`, no manual `import {h}` needed.

### Pre-commit Hook

Husky + lint-staged automatically run:

- `eslint --fix` + `prettier --write` on staged `.ts` / `.tsx` files
- `markdownlint-cli2 --fix` + `prettier --write` on staged `.md` files
- `prettier --write` on staged `.css`, `.html`, `.json`, `.yaml`, and `.yml` files

---

## Architecture Rules

Module boundaries are enforced by [dependency-cruiser](https://github.com/sverweij/dependency-cruiser):

- `popup/` cannot import from `background/` or `devtools/`
- `devtools/` cannot import from `background/` or `content/`
- `devtools/` may only import from `popup/components/` within `popup/`
- `content/` cannot import from `background/`, `popup/`, or `devtools/`
- `shared/` cannot import from any other layer
- Check modules (`background/checks/`) may only import from `shared/` and `background/checks/`
- The Scan (`scan-orchestrator.ts`, `scan-assessment.ts`, `frame-merge.ts`, `captured-traffic.ts`) reaches the browser only through the `ScanBrowser` port in `scan-browser.ts`, and the tab state (`tab-state.ts`) only through its `TabStateBrowser` port; only the service worker imports the Chrome adapters (`chrome-scan-browser.ts`, `chrome-tab-state-browser.ts`), and only the Chrome scan adapter imports the network recorder and npm registry
- Only the popup and DevTools panel roots import the Chrome tab state client (`popup/components/chrome-tab-state-client.ts`)
- The config field schema (`shared/checkout-config-schema.ts`), the Adyen endpoint reading (`shared/adyen-endpoint.ts`), and the port (`scan-browser.ts`) may import `shared/types.ts` only; the other shared modules that content scripts inline (capture record, configuration evidence, SDK presence, checkout signals) have their own allow-lists

Run `pnpm depcruise` to verify.

ESLint enforces the seams that dependency-cruiser cannot see:

- Checks and the implementation-attribute rules read checkout configuration through `shared/scan-evidence.ts`, never through the raw `capturedConfig`, `componentConfig`, `inferredConfig`, or `pageJsonConfig` slots.
- Checks read response headers through `readDocumentHeader()` and CSP through `readPagePolicy()` (`background/checks/page-policy.ts`), never `payload.documentHeaders`.
- Checks, the Scan, and the tab state do not use `chrome`, `fetch`, `setTimeout`, or `Date.now`; the scan lifecycle hook does not use `chrome`.
- Popup, DevTools, and the worker read `ScanResult.sdkPresence` and do not reference the `sdk-detected` check.
- Popup, DevTools, and the worker read `ScanResult.attributes` and render issue rows from the finding projection; they do not import the implementation-attribute rules, `shared/results.ts`, or the `STORAGE_*` key prefixes.

The build fails if a content-script bundle contains ESM `import`/`export` statements, because Chrome runs content scripts as classic scripts.

---

## Writing a Check

Every check is a **pure function** — synchronous, no side effects, independently testable. Checks should distinguish verified absence from partial or inferred evidence; skip when evidence is insufficient and use `notice` when a finding needs manual verification rather than claiming an unverified failure.

Read implementation attributes (integration flavor and flow, environment, region, import method, checkout activity) from the runner context's `attributes`; the Scan derives them once per payload. Read checkout configuration with `readCheckoutField(payload, key)`. It returns `present` (with the value and its source: `captured`, `component`, or `inferred`, plus the `signal` for inferred values: `adyen-request` or `page-json`), `absent` (proven by AdyenCheckout options captured whole), or `unobserved` (with reason `no-config` or `partial-config`). Pass `{ includeInferred: false }` when inferred values must not count. Each check decides the severity for each state; only `absent` may justify a missing-field failure. Read response headers with `readDocumentHeader(payload, name)`, which returns `present`, `absent`, or `unavailable`; skip header checks when headers are unavailable.

### 1. Create the check

Add or extend a file in `src/background/checks/`. Each check implements:

```typescript
interface Check {
  readonly id: CheckId;
  readonly category: CheckCategory;
  run(payload: ScanPayload): CheckResult;
}
```

Use the check registry helper (`createRegistry`) and the runner context helpers (`pass`, `fail`, `warn`, `notice`, `skip`, `info`):

```typescript
export const SECURITY_CHECKS = createRegistry('security')
  .add('my-check', (_payload, { pass, fail }) => {
    if (/* condition */) {
      return fail('Explain the issue', 'Optional detail', 'How to fix', 'https://docs...');
    }
    return pass('All good.');
  })
  .getChecks();
```

### 2. Register the check

Add it to the module's exported array (e.g. `SECURITY_CHECKS` or `CSP_CHECKS`), add its ID to `CheckId` in `src/shared/types.ts`, and ensure the array is included in `src/background/checks/index.ts` → `ALL_CHECKS`.

### 3. Write tests

Create or update a test file in `tests/unit/checks/`. Use the fixture factories from `tests/fixtures/makeScanPayload.ts`:

```typescript
import { SECURITY_CHECKS } from '../../../src/background/checks/security';
import {
  makeCapturedConfig,
  makeCheckoutConfig,
  makeCheckoutPage,
  makeScanPayload,
} from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const httpsCheck = requireCheck(SECURITY_CHECKS, 'security-https');

it('fails for live checkout over HTTP', () => {
  const payload = makeScanPayload({
    page: makeCheckoutPage({
      pageProtocol: 'http:',
      capturedConfig: makeCapturedConfig(makeCheckoutConfig({ environment: 'live' })),
    }),
  });
  expect(httpsCheck.run(payload).severity).toBe('fail');
});
```

**Coverage target:** every file in `src/` needs 100% lines, statements, branches, and functions, enforced per file in CI. When a branch cannot be reached through the module's interface, remove it instead of excluding it from coverage.

### 4. Update the check catalog

Add the check to `docs/architecture/check-catalog.md`.
`tests/unit/docs/check-catalog.test.ts` checks the catalog's inventory, category counts, and notice lists against `ALL_CHECKS`. `tests/unit/docs/documentation.test.ts` checks local links, documented pnpm commands, README health tiers, and manifest/Sonar/package version parity. Both run in the standard unit-test gate.

---

## Testing

### Unit tests

```bash
pnpm test              # Run once
pnpm test:watch        # Watch mode
pnpm test:coverage     # With V8 coverage report
```

Tests live in `tests/unit/` and use [Vitest](https://vitest.dev) with a `jsdom` environment.

Scan tests drive `runScan()` through the in-memory `ScanBrowser` adapter in `tests/fixtures/fakeScanBrowser.ts` (`createFakeScanBrowser()`, `framesOf()`). It records port calls, serves script text from memory, and uses a virtual clock, so settle, retry, bundle-version, and header-fallback behaviour is tested without Chrome. Frame selection is tested directly through `mergeFrames()`.

Tab state tests drive `createTabState()` through the in-memory adapter in `tests/fixtures/fakeTabStateBrowser.ts`, including navigation while a Scan is pending. Page extraction tests run the real content script against a jsdom document and page globals.

### Integration tests

```bash
pnpm test:integration  # Cross-module scan pipeline
```

### E2E tests

```bash
pnpm test:e2e          # Build, then Playwright + Chromium
```

E2E tests build and load the extension (`dist/`) into a headless Chromium persistent context, scan offline fixture pages, and verify what the popup and DevTools panel render. Run `pnpm test:e2e --headed` to watch the browser while debugging. Install Playwright Chromium first (`pnpm exec playwright install chromium`) if it is not already available.

### Dead code

```bash
pnpm knip
```

[knip](https://knip.dev) detects unused exports, unreferenced files, and redundant dependencies. `pnpm knip` runs it twice: once over source and tests, and once in production mode (`knip --production`), which reports exports that only tests use.

---

## CI

GitHub Actions runs the full validation pipeline on every push and PR:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm lint` (ESLint, pinned GitHub Actions, Markdown)
4. `pnpm format:check`
5. `pnpm depcruise`
6. `pnpm knip`
7. `pnpm test:coverage`
8. `pnpm test:integration`
9. `pnpm build`
10. `pnpm exec playwright install chromium`
11. `pnpm exec playwright test` (E2E against the build from step 9)
12. Upload `dist/` as artifact

A separate weekly workflow (`.github/workflows/links.yml`, also runnable on demand) checks that the documentation links in check modules are reachable, because those tests make live requests and are skipped in the normal test run.

---

## Reporting Issues

Please open a GitHub issue with:

- Steps to reproduce
- Expected vs actual behaviour
- Chrome version and OS
- Extension version (from `public/manifest.json`)

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
