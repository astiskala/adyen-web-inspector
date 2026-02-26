# Adyen Web Inspector

Adyen Web Inspector is a Chrome Manifest V3 extension that inspects `adyen-web` integrations (Drop-in / Components) directly in the browser.

> Disclaimer: This is an independent project and is not an official Adyen product.

## Features

- Detects SDK version, flavor, environment, region, and import method.
- Runs 40 pure checks across SDK setup, callbacks, auth, risk, security, and third-party scripts.
- Provides actionable findings with remediation and documentation links.
- Shows a health score with tiering (`excellent`, `good`, `issues`, `critical`).
- Exports scan results as JSON and PDF.

## Check Coverage

| Category          | Checks |
| ----------------- | ------ |
| SDK Identity      | 5      |
| Version Lifecycle | 2      |
| Environment       | 3      |
| Auth              | 3      |
| Callbacks         | 8      |
| Risk              | 2      |
| Security          | 13     |
| Third-party       | 4      |

Full check and rule reference: [docs/architecture/check-catalog.md](docs/architecture/check-catalog.md)

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+

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

## Quality Commands

```bash
pnpm typecheck
pnpm lint
pnpm lint:md
pnpm format
pnpm format:check
pnpm test
pnpm test:e2e
pnpm validate
```

`pnpm lint` runs ESLint for TypeScript files and markdownlint for Markdown files.
`pnpm validate` runs the local quality gate: typecheck, lint, format check, dependency-cruiser, knip, and unit tests. CI also runs coverage, build, and E2E tests.

## Architecture

### Main components

- `src/background/worker.ts`: service worker message routing and badge state.
- `src/background/scan-orchestrator.ts`: scan pipeline and payload assembly.
- `src/background/checks/*`: pure check modules.
- `src/content/detector.ts`: passive page-level Adyen detection.
- `src/content/page-extractor.ts`: on-demand page-world extraction.
- `src/popup/*`: compact summary UI.
- `src/devtools/*`: full analysis panel UI.
- `src/shared/*`: types, constants, shared helpers, export logic.

### Scan pipeline

1. Start per-tab network/header collection.
2. Wait for the tab to be ready and allow SPA settle time.
3. Extract page data in `world: "MAIN"`.
4. Merge collected requests with fallback request discovery.
5. Resolve SDK version signals and latest npm version.
6. Build `ScanPayload`.
7. Run all checks.
8. Persist and broadcast `ScanResult`.

## Additional Docs

- Check catalog and rule logic: [docs/architecture/check-catalog.md](docs/architecture/check-catalog.md)
- Chrome Web Store release flow: [docs/release/chrome-web-store-publish.md](docs/release/chrome-web-store-publish.md)
- Privacy policy: [docs/legal/privacy-policy.md](docs/legal/privacy-policy.md)

## License

[MIT](LICENSE)
