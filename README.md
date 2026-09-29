# Adyen Web Inspector

Adyen Web Inspector is a Chrome Manifest V3 extension that inspects `adyen-web` integrations (Drop-in / Components) directly in the browser.

> Disclaimer: This is an independent project and is not an official Adyen product.

## Features

- Infers SDK version, integration flavor and flow, environment, region, and visible script origin; unavailable signals remain unknown.
- Runs browser-visible checks across SDK setup, callbacks, auth, risk, security, and third-party scripts.
- Provides findings with remediation and documentation links, including items requiring manual review.
- Shows a health score with tiering (`excellent`, `issues`, `critical`); `info`, `notice`, and `skip` results do not affect the score.
- Exports scan results as JSON and printable PDF reports.

## Getting Started

### Prerequisites

- Node.js 24+
- pnpm 10.33.2 (pinned in `package.json`)

### Install

```bash
pnpm install
```

### Build for development

```bash
pnpm dev
```

Then load `dist/` in Chrome:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select the `dist/` directory

### Production build

```bash
pnpm build
```

## Using the extension

1. Open a checkout page and click the extension icon. The passive badge detects mounted Adyen elements; click **Run Scan** to inspect the current tab (or **Attempt Scan** if detection missed it).
2. For detailed results, open Chrome DevTools and select the **Adyen Inspector** panel. Run or re-run a scan there to view the overview, findings, skipped checks, observed network requests, and extracted config.
3. Use **Export JSON** in DevTools to download the full scan result, including captured configuration fields and observed URLs. Use **Export PDF** in the popup or panel to open a printable report; save it as PDF in the browser print dialog.

The popup hides scan controls when it detects an SDK version below v6; the DevTools panel can still run scans for inspection. Scans are snapshots of browser-visible signals, not proof of server-side settings or payment success. Findings marked for manual review require independent verification. Treat exported results as sensitive if the inspected page exposes sensitive URLs or configuration.

## Quality Commands

```bash
pnpm typecheck
pnpm lint
pnpm lint:md
pnpm format:check
pnpm test
pnpm test:integration
pnpm depcruise
pnpm knip
pnpm test:e2e
pnpm validate
```

`pnpm lint` runs ESLint, checks GitHub Actions are pinned, and runs markdownlint. `pnpm format:check` checks formatting without rewriting files (`pnpm format` writes changes). `pnpm test:e2e` builds before running Playwright headless; add `--headed` to watch the browser. CI also installs Chromium.
`pnpm validate` runs typecheck, lint, format check, dependency-cruiser, knip, unit coverage, and integration tests. CI also runs build and E2E tests.
Contributor workflow and coding conventions: [CONTRIBUTING.md](CONTRIBUTING.md)

## Architecture

### Main components

- `src/background/worker.ts`: service worker routing of messages and tab events to the tab state.
- `src/background/tab-state.ts`: per-tab state (checkout activity, scan result, badge, Scan in flight) and its lifecycle rules, reached through a port with Chrome (`chrome-tab-state-browser.ts`) and in-memory adapters.
- `src/background/scan-orchestrator.ts`: scan sequencing and retries, driven through the browser port in `scan-browser.ts`.
- `src/background/frame-merge.ts`: turns every frame's page extraction into the Checkout page.
- `src/background/chrome-scan-browser.ts`: Chrome adapter for the browser port (tabs, scripting, webRequest, fetch).
- `src/background/scan-assessment.ts`: payload assembly and assessment.
- `src/background/checks/*`: pure check modules.
- `src/content/config-interceptor.ts`: MAIN-world config capture (CDN and NPM).
- `src/content/detector.ts`: passive checkout activity detection.
- `src/content/page-extractor.ts`: on-demand page-world extraction.
- `src/shared/checkout-config-schema.ts`: the single mapping from raw Adyen Web options to checkout configuration fields.
- `src/shared/scan-evidence.ts`: checkout configuration evidence (present, absent, or unobserved per field).
- `src/shared/sdk-version.ts`: SDK version signals, their precedence, and the release-date lookup.
- `src/shared/implementation-attributes.ts`: integration flavor, flow, environment, region, and import method, derived once per scan.
- `src/shared/export-report.ts`: the finding projection every view and report renders.
- `src/popup/*`: compact summary UI.
- `src/devtools/*`: full analysis panel UI.
- `src/shared/*`: types, constants, shared helpers, export logic.

### Scan pipeline

1. Start per-tab network/header collection.
2. Wait for the tab to be ready and allow SPA settle time.
3. Extract page data in `world: "MAIN"` in every accessible frame, retrying briefly while the SDK is still loading, then merge the frames into the Checkout page.
4. Merge collected requests with fallback request discovery.
5. Resolve the SDK version from the strongest signal, fetching same-origin bundles only as a last resort, and attach the latest npm version.
6. Build `ScanPayload` and derive its implementation attributes.
7. Run all checks.
8. Return `ScanResult`, including its SDK presence verdict and implementation attributes. The tab state stores and broadcasts it unless the tab navigated during the Scan.

The scan runs every browser operation through the `ScanBrowser` port, so steps 1–8 are unit-tested with an in-memory adapter; the tab state is tested the same way through its own port. E2E tests cover the Chrome adapters in a real browser.

## Additional Docs

- Check catalog and rule logic: [docs/architecture/check-catalog.md](docs/architecture/check-catalog.md)
- Contributor workflow: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Privacy policy: [docs/legal/privacy-policy.md](docs/legal/privacy-policy.md)

## License

[MIT](LICENSE)
