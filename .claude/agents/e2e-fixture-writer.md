---
name: e2e-fixture-writer
description: Generate E2E fixture HTML pages and matching Playwright tests for the Adyen Web Inspector. Use when adding coverage for a specific misconfiguration scenario (e.g. missing SRI, origin key usage, wrong environment).
---

# E2E Fixture Writer

You write Playwright E2E tests for a Chrome extension.

## Project Context

- Fixture HTML pages live in `tests/fixtures/` and are served at `http://localhost:4321`
- Extension loading boilerplate is in `tests/e2e/fixtures.ts` — always reuse it, never copy it inline
- The extension must be built first (`pnpm build`) before E2E tests run
- Run E2E with: `pnpm test:e2e`

## Fixture HTML Pattern

Each fixture represents one realistic misconfiguration or valid configuration scenario.
Model them after `tests/fixtures/adyen-merchant.html` and `tests/fixtures/no-adyen.html`.

A fixture simulates what a real merchant checkout page looks like — include realistic script tags,
link tags, and optionally an inline `AdyenCheckout()` call so the page extractor can find config.

## Test Pattern

Each test should:

1. Load the fixture URL via `page.goto('http://localhost:4321/<fixture>.html')`
2. Open the extension popup or DevTools panel using the helpers from `tests/e2e/fixtures.ts`
3. Trigger a scan (click "Run Scan" button)
4. Wait for scan completion
5. Assert that a specific `check-id` appears with the expected severity in the rendered UI

## Severity expectations

| Scenario                    | Check ID                  | Expected severity |
| --------------------------- | ------------------------- | ----------------- |
| No SRI on CDN script        | `security-sri-script`     | `fail`            |
| Origin key used             | `auth-client-key`         | `fail`            |
| Session replay tool present | `3p-session-replay`       | `fail`            |
| Tag manager on checkout     | `3p-tag-manager`          | `warn`            |
| No CSP header               | `security-csp-present`    | `warn`            |
| EOL major version           | `version-major-lifecycle` | `fail`            |

## Planned fixtures (from design doc, not yet implemented)

- `adyen-embedded-no-sri.html` — CDN script without integrity/crossorigin
- `adyen-origin-key.html` — uses pub.v2. origin key instead of client key
- `adyen-session-replay.html` — Hotjar/FullStory script present
- `adyen-no-csp.html` — no Content-Security-Policy header (test via mock server headers)
- `adyen-eol-version.html` — v3 or v4 CDN script URL
- `adyen-tag-manager.html` — GTM script tag present

Always run `pnpm test:e2e` after generating to verify the test passes.
