# Adyen Web Inspector — Design Document

**Date:** 2026-02-24
**Status:** Approved
**Author:** Adam (with Claude Code)

---

## Overview

Adyen Web Inspector is a Chrome Extension that analyses the quality and correctness of an
adyen-web (Drop-in / Components) implementation directly from the browser. It is designed for
Adyen Implementation Engineers, Technical Support Engineers, Account Managers, and merchants
doing self-service validation.

The extension is a personal project with the intent to eventually become an official Adyen tool.
The Adyen trademark is used descriptively; branding will be reviewed before any official
publication to the Chrome Web Store.

---

## Goals

- Surface the "flavor", version, environment, region, and import method of any adyen-web
  integration at a glance.
- Run a battery of best-practice checks (drawn from Adyen's official documentation and the
  PDF checklist) and present results in a friendly, actionable format.
- Serve both Adyen staff (power users who need raw technical detail) and merchants
  (self-service users who need plain-language guidance) from the same UI.
- Export findings as JSON (for tooling/tickets) or PDF (for sharing with stakeholders).
- Have zero negative impact on the merchant's checkout experience when the extension is
  installed but idle.

## Non-Goals (v1)

- Server-side integration review (webhook handling, idempotency, API call correctness).
- Automated remediation / code patching.
- Support for non-web Adyen SDKs (iOS, Android, React Native).
- Side Panel UI (Chrome 114+ feature — deferred to v2).

---

## Architecture

### Manifest V3 Extension Components

| Component | Entry point | Role |
|-----------|-------------|------|
| Background Service Worker | `src/background/worker.ts` | Scan orchestrator. Manages `chrome.webRequest` listeners, triggers page reload, runs `chrome.scripting.executeScript`, fetches npm registry, aggregates results into `chrome.storage.session`. |
| Content Script | `src/content/detector.ts` | Passive, always-on. Lightweight Adyen detection only. Sets toolbar badge when Adyen is found. Never runs expensive analysis. |
| Page-World Extractor | `src/content/page-extractor.ts` | Executed via `chrome.scripting.executeScript` with `world: "MAIN"` at scan time. Reads `window.AdyenWebMetadata`, checkout config, cookies, DOM signals. |
| Popup | `src/popup/` | Toolbar badge click. Quick health score, identity card, top issues, links to DevTools panel. |
| DevTools Panel | `src/devtools/` | Full inspection UI. Tabs: Overview, Best Practices, Network, Security, Raw Config. |

### Permissions

```jsonc
{
  "permissions": [
    "activeTab",          // Run scripts on the active tab
    "scripting",          // chrome.scripting.executeScript
    "webRequest",         // Intercept network request headers
    "storage",            // chrome.storage.session + local (npm cache)
    "declarativeContent"  // Badge logic
  ],
  "host_permissions": ["<all_urls>"]
  // Required to inspect arbitrary merchant checkout pages.
  // No data is sent to external servers except registry.npmjs.org for version checking.
}
```

### Module Structure

```
src/
├── background/
│   ├── worker.ts                   # Service worker entry point
│   ├── scan-orchestrator.ts        # Drives the scan pipeline
│   ├── header-collector.ts         # webRequest listener
│   ├── npm-registry.ts             # Latest version check (24h cache)
│   └── checks/                     # One file per check — pure functions
│       ├── sdk-identity.ts
│       ├── sdk-version.ts
│       ├── environment.ts
│       ├── auth.ts
│       ├── callbacks.ts
│       ├── risk-module.ts
│       ├── security-sri.ts
│       ├── security-csp.ts
│       ├── security-headers.ts
│       └── third-party-scripts.ts
├── content/
│   ├── detector.ts                 # Passive detection → badge
│   └── page-extractor.ts           # Page-world extraction script
├── popup/
│   ├── index.html
│   ├── popup.ts
│   ├── Popup.tsx
│   └── components/
│       ├── HealthScore.tsx
│       ├── IdentityCard.tsx
│       ├── IssueList.tsx
│       └── NotDetected.tsx
├── devtools/
│   ├── devtools.html               # Registers the panel
│   ├── devtools.ts
│   └── panel/
│       ├── Panel.tsx
│       └── tabs/
│           ├── OverviewTab.tsx
│           ├── BestPracticesTab.tsx
│           ├── NetworkTab.tsx
│           ├── SecurityTab.tsx
│           └── RawConfigTab.tsx
└── shared/
    ├── types.ts                    # ScanResult, CheckResult, ScanPayload, etc.
    ├── messages.ts                 # BSW ↔ UI message type definitions
    ├── constants.ts                # Adyen domains, environment URLs, lifecycle table
    └── utils.ts
```

---

## Toolchain

### Package Manager & Build

| Tool | Choice | Rationale |
|------|--------|-----------|
| Package manager | **pnpm** | Strict hoisting, fast, workspace-ready |
| Build tool | **Vite 5** (multi-entry) | Vite-native TypeScript, fast HMR in dev, one config for all entry points |
| UI framework | **Preact** | React-compatible API, 3KB vs 40KB — important for extension bundle size |
| Styling | **CSS Modules** | Scoped styles, zero runtime, works cleanly with Vite |

### Code Quality

| Tool | Role |
|------|------|
| **TypeScript 5** | `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` |
| **gts** | Google TypeScript Style — ESLint + Prettier base config |
| **ESLint** (via gts) | Extended with `@typescript-eslint` strict rules |
| **Prettier** (via gts) | Consistent formatting, enforced in CI |
| **SonarLint** | IDE-level code smell and security hotspot detection (VS Code extension + `sonar-project.properties` for SonarCloud CI integration) |
| **dependency-cruiser** | Validates module boundaries: `popup/` cannot import `background/`; `shared/` cannot import from any other layer |
| **knip** | Dead code detection — unused exports, unreferenced files, redundant dependencies |

### Git Hygiene

| Tool | Role |
|------|------|
| **Husky** | Git hooks manager |
| **lint-staged** | Pre-commit: `eslint --fix` + `prettier --write` on staged files only |
| **commitlint** | Conventional Commits format enforced (`feat:`, `fix:`, `chore:`, etc.) |

### `package.json` Scripts

```jsonc
{
  "scripts": {
    "dev":           "vite build --watch",
    "build":         "vite build",
    "typecheck":     "tsc --noEmit",
    "lint":          "eslint src --ext .ts,.tsx",
    "lint:fix":      "eslint src --ext .ts,.tsx --fix",
    "format":        "prettier --write src",
    "format:check":  "prettier --check src",
    "test":          "vitest run",
    "test:watch":    "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e":      "playwright test",
    "depcruise":     "depcruise src --config .dependency-cruiser.cjs",
    "knip":          "knip",
    "validate":      "pnpm typecheck && pnpm lint && pnpm format:check && pnpm depcruise && pnpm knip && pnpm test"
  }
}
```

### CI Pipeline (GitHub Actions)

Runs on every push and pull request:

1. `pnpm install`
2. `tsc --noEmit` — type check
3. `eslint src` — lint
4. `prettier --check src` — format
5. `depcruise src` — architecture boundaries
6. `knip` — dead code
7. `vitest --coverage` — unit tests + coverage (90% threshold on check modules)
8. `playwright test` — E2E tests (Chromium)
9. Build extension zip — uploaded as artifact

---

## Scan Pipeline

### Passive Detection (always-on, zero overhead)

On every page navigation, the content script runs a targeted selector check and a single
`executeScript` call to check for `window.AdyenWebMetadata`. If Adyen is found, it notifies
the background service worker which sets a green badge on the toolbar icon. No DOM traversal,
no network calls, no impact on page performance.

### Full Scan (on demand)

Triggered when the user clicks "Run Scan" in the popup or DevTools panel. The page is
automatically reloaded so all network requests and response headers can be intercepted from
the start. Steps:

1. **Setup** — Register `chrome.webRequest` listeners
2. **Reload** — `chrome.tabs.reload(tabId)`, wait for `onCompleted`
3. **Header collection** — Collect response headers for main document and Adyen CDN resources
4. **Page extraction** — `executeScript({ world: "MAIN" })` to read JS globals, DOM state,
   cookies, script/link tags, iframe presence
5. **External data** — Fetch `registry.npmjs.org/adyen-web` (cached 24h in
   `chrome.storage.local`)
6. **Check execution** — Run all check modules against the aggregated `ScanPayload`
7. **Storage** — Write `ScanResult` to `chrome.storage.session` keyed by `tabId`
8. **Notify UI** — `chrome.runtime.sendMessage(SCAN_COMPLETE)` to popup and DevTools panel

### Check Module Contract

Every check is a **pure function** — synchronous, no side effects, independently testable:

```typescript
interface Check {
  id: string;
  category: CheckCategory;
  run(payload: ScanPayload): CheckResult;
}
```

Helper factory functions (`pass`, `fail`, `warn`, `skip`, `info`) keep check implementations
concise and consistent.

---

## Check Registry

### Severity Scale

| Severity | Meaning |
|----------|---------|
| `pass` | Check passed |
| `warn` | Advisory — works but not ideal |
| `fail` | Violation — should be fixed |
| `info` | Informational — no scoring impact |
| `skip` | Not applicable to this integration type |

### Health Score

```
Score = passing / (total − skipped − info)
```

Display tiers: 🟢 90–100% Excellent · 🟡 70–89% Good · 🟠 50–69% Issues detected · 🔴 <50% Critical

---

### Category 1 — SDK Identity

| ID | Severity | What | How |
|----|---------|------|-----|
| `sdk-detected` | `info` | Adyen Web is present | DOM + `window.AdyenWebMetadata` |
| `sdk-flavor` | `info` | Drop-in / CardComponent / other | Component type + DOM class names |
| `sdk-import-method` | `info` | `npm` vs `embedded-script` | Presence of `<script src="checkoutshopper-*">` |
| `sdk-bundle-type` | `warn` if auto | Tree-shakable vs `auto` bundle | `window.AdyenWebMetadata.bundleType`; `skip` for embedded-script |
| `sdk-metadata-exposed` | `info` | `exposeLibraryMetadata` is true | `window.AdyenWebMetadata` exists |

### Category 2 — Version & Lifecycle

| ID | Severity | What | How |
|----|---------|------|-----|
| `version-detected` | `warn` if unknown | Version is known | `window.AdyenWebMetadata.version` or script URL |
| `version-latest` | `warn` | Within 3 patch versions of latest | npm registry vs detected |
| `version-major-lifecycle` | `fail` | Not on deprecated/EOL major (v4 = deprecated) | Major version vs lifecycle table |
| `version-minor-gap` | `warn` | Not more than 2 minor versions behind | Minor version comparison |

### Category 3 — Environment & Region

| ID | Severity | What | How |
|----|---------|------|-----|
| `env-detected` | `info` | `test` vs `live` | Client key prefix + network requests |
| `env-region` | `info` | EU / US / AU / APSE / IN | Network request base URL |
| `env-key-mismatch` | `fail` | Client key prefix matches environment | `test_` key + live endpoint = fail |
| `env-https` | `fail` | Live environment served over HTTPS | Page URL protocol + environment |
| `env-not-iframe` | `warn` | Checkout not inside an `<iframe>` | `window.self !== window.top` |

### Category 4 — Client Key & Authentication

| ID | Severity | What | How |
|----|---------|------|-----|
| `auth-client-key` | `warn` | Client key, not origin key (`pub.` prefix) | Checkout config `clientKey` value |
| `auth-country-code` | `fail` | `countryCode` is set | Checkout config object |
| `auth-locale` | `warn` | `locale` is explicitly set | Checkout config object |

### Category 5 — Integration Flow & Callbacks

| ID | Severity | What | How |
|----|---------|------|-----|
| `flow-type` | `info` | Sessions vs Advanced flow | Network: presence of `/sessions` calls |
| `callback-on-submit` | `fail` | `onSubmit` present (Advanced flow) | Config callback presence |
| `callback-on-additional-details` | `fail` | `onAdditionalDetails` present (Advanced) | Config callback presence |
| `callback-on-payment-completed` | `warn` | `onPaymentCompleted` present | Config callback presence |
| `callback-on-payment-failed` | `warn` | `onPaymentFailed` present (v6+) | Config callback presence |
| `callback-on-error` | `fail` | `onError` present | Config callback presence |
| `callback-before-submit` | `info` | `beforeSubmit` present (if custom pay button) | Config callback presence |
| `callback-actions-pattern` | `warn` | v6 `actions.resolve()` / `actions.reject()` pattern | Static analysis of `onSubmit` source |

### Category 6 — Risk Module

| ID | Severity | What | How |
|----|---------|------|-----|
| `risk-rp-uid-cookie` | `warn` | `_RP_UID` cookie present | `document.cookie` |
| `risk-df-iframe` | `warn` | Device fingerprint iframe loaded | DOM `iframe[name="dfIframe"]` + network `dfp.*.html` |
| `risk-module-not-disabled` | `warn` | Risk module not explicitly disabled | Config `riskEnabled` |

### Category 7 — Security

| ID | Severity | What | How |
|----|---------|------|-----|
| `security-sri-script` | `fail` | Adyen `<script>` has `integrity` + `crossorigin` (embedded only) | DOM |
| `security-sri-css` | `warn` | Adyen `<link>` has `integrity` + `crossorigin` (embedded only) | DOM |
| `security-csp-present` | `warn` | `Content-Security-Policy` header present | Response headers |
| `security-csp-script-src` | `warn` | CSP `script-src` includes Adyen domains | Parse CSP header |
| `security-csp-frame-src` | `warn` | CSP `frame-src` permissive enough for 3DS iframes | Parse CSP header |
| `security-csp-frame-ancestors` | `warn` | `frame-ancestors` or `X-Frame-Options` present | Headers |
| `security-csp-reporting` | `info` | CSP `report-to` / `report-uri` configured | Parse CSP header |
| `security-referrer-policy` | `warn` | `Referrer-Policy: strict-origin-when-cross-origin` | Headers |
| `security-x-content-type` | `warn` | `X-Content-Type-Options: nosniff` | Headers |
| `security-xss-protection` | `warn` | `X-XSS-Protection` disabled or absent | Headers |
| `security-hsts` | `warn` | `Strict-Transport-Security` present (live env) | Headers |
| `security-iframe-referrerpolicy` | `info` | Adyen iframes have `referrerpolicy="origin"` | DOM |

### Category 8 — Third-Party Scripts

| ID | Severity | What | How |
|----|---------|------|-----|
| `3p-tag-manager` | `warn` | GTM, Tealium, or similar on checkout page | DOM `<script>` src patterns |
| `3p-analytics` | `info` | Google Analytics / GA4 | DOM |
| `3p-session-replay` | `fail` | Hotjar, FullStory, Clarity, Mouseflow, LogRocket | DOM script src + global variable patterns |
| `3p-ad-pixels` | `warn` | Meta Pixel, TikTok Pixel, etc. | DOM |
| `3p-no-sri` | `warn` | Any of the above loaded without `integrity` | DOM |

---

## UI Design

### Design Principles

- **Browser-native feel** — no external component libraries. Native HTML elements
  (`<details>/<summary>`, `<dialog>`, `<table>`, `<select>`) wherever possible. The extension
  should be indistinguishable from a first-party Chrome tool.
- **Chrome DevTools color palette** — CSS custom properties mirroring Chrome's own tokens
  (`#1a73e8` blue, `#d93025` red, `#188038` green, `#f29900` amber, `#5f6368` secondary text).
  Both light and dark theme supported via `prefers-color-scheme`.
- **System font stack** — `system-ui, -apple-system, sans-serif` for UI;
  `Menlo, Monaco, 'Courier New', monospace` for code and raw values.
- **Information density** — same compact row height and padding as Chrome's Network/Elements
  panels.
- **No animations** beyond native browser defaults.
- **Popup width** — fixed 360px.

### Popup

Two states: **Adyen detected** and **Adyen not detected**.

Detected state:
- Identity card: flavor · version · environment · region · import method
- Health score: percentage + progress bar + pass/total count, colour-coded
- Critical issues list: expanded by default, each row a single plain-language sentence;
  clicking expands technical detail + remediation inline
- Warnings: collapsed by default with count badge
- Footer: `[Open Full Inspector]` → opens/focuses DevTools panel;
  `[Copy Report]` → Markdown summary to clipboard

### DevTools Panel

Registered as a tab inside Chrome DevTools alongside Elements, Console, Network.

| Tab | Content |
|-----|---------|
| **Overview** | Identity card, per-category pass/warn/fail summary, `[Re-run Scan]`, `[Export JSON]`, `[Export PDF]` |
| **Best Practices** | Full check list grouped by category. Filter bar (All / Failures / Warnings). Each failing/warning row expands to show: plain-language explanation, technical detail, remediation snippet, docs link, `[Copy fix]`. |
| **Network** | Timeline of all Adyen-related requests captured during scan: API calls, CDN resources, analytics, device fingerprint iframe. |
| **Security** | HTTP response headers table with pass/fail per header. SRI status. Third-party script inventory with risk categories. |
| **Raw Config** | Full `ScanResult` JSON — `window.AdyenWebMetadata`, detected config, response headers. Syntax-highlighted, collapsible. |

### Export

- **JSON** — full `ScanResult` object. For tooling, Jira tickets, automated processing.
- **PDF** — generated client-side via printable HTML template in a hidden iframe +
  `window.print()`. No server required. Layout: header with domain + date, identity card,
  health score, full check list by category, "Generated by Adyen Web Inspector" footer.

---

## Testing Strategy

### Unit Tests (Vitest)

All check modules (`src/background/checks/*.ts`) are pure functions tested in isolation
using a `makeScanPayload()` fixture factory. Each check has its own test file covering:
pass, fail, warn, and skip states.

Coverage target: **90% line coverage** on check modules, enforced in CI.

### Integration Tests (Vitest)

Scan orchestrator tested with mocked `ScanPayload`. Verifies:
- Full check registry runs without errors
- `ScanResult` shape is correct
- Health score calculation excludes `skip` and `info` checks

### E2E Tests (Playwright)

Playwright loads the built extension in Chromium via `launchPersistentContext`. Tests cover
UI interactions and rendering. Analysis logic is covered by unit tests.

**Against `mystoredemo.io`**: Adyen detected, version visible, health score rendered.
**Against local fixture pages** (served by Playwright's static server):

| Fixture | Purpose |
|---------|---------|
| `adyen-embedded-no-sri.html` | `security-sri-script` fail |
| `adyen-origin-key.html` | `auth-client-key` warn |
| `adyen-test-env.html` | Environment/region checks |
| `adyen-no-callbacks.html` | Callback checks |
| `adyen-npm-auto-bundle.html` | `sdk-bundle-type` warn |
| `adyen-clean.html` | All checks pass — regression guard |

---

## Future Considerations (v2+)

- **Side Panel** (Chrome 114+) — same content as DevTools panel, accessible without opening
  DevTools. Better for merchant self-service.
- **Version regression watch items** — flag known version-specific bugs (e.g.
  `beforeSubmit` regression in versions > 6.25.1).
- **Accessibility checks** — ARIA labeling strategy, keyboard navigation, SDK version ≥ v5.49.0
  for Level AA compliance.
- **Redirect return page detection** — check that `redirectResult`/`threeDSResult` handling
  is correct on return pages.
- **SonarCloud integration** — full CI quality gate with SonarCloud project.
