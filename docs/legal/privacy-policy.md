# Privacy Policy

Last updated: 2026-09-28

Adyen Web Inspector is a browser extension that analyzes browser-visible Adyen Web integrations. Its passive detector and MAIN-world configuration interceptor run on matching HTTP(S) pages, including before you request a scan. The detector checks for Adyen elements; the interceptor wraps selected page APIs to capture checkout configuration and infer values from URLs and parsed objects. Full inspection runs only when you start a scan.

## What the extension processes

When you run a scan, the extension may process:

- The inspected page URL, protocol, and observed request URLs (which may include query parameters)
- Checkout settings relevant to checks (including `clientKey`, `environment`, `locale`, `countryCode`, callback registration, and short excerpts of `onSubmit`/`beforeSubmit` function source)
- SDK metadata, script, stylesheet, iframe, resource-timing, and CSS-rule information
- Response headers for the inspected page and captured Adyen-related requests
- Selected Adyen checkout analytics POST fields used for SDK identification (for example `flavor`, `version`, `buildType`, `locale`, `sessionId`); the rest of the request body is not stored

## How data is used

Processed data is used locally to generate scan findings, health scores, and reports. JSON exports include the full scan payload (including observed URLs, headers, and captured and inferred configuration fields); the printable report includes captured/inferred fields and observed network data. Review exports before sharing them.

## Network requests made by the extension

The extension can make network requests to:

- The currently scanned page URL (`HEAD`, falling back to `GET` for response-header probing, with page credentials) and same-host script URLs (SDK version fallback, without credentials)
- `https://registry.npmjs.org/@adyen/adyen-web/latest` to check the latest SDK version

During a scan, page and Adyen-related response headers and selected Adyen checkout analytics POST fields are passively observed via `chrome.webRequest`; the extension does not replay those page requests.

## Data sharing

- The extension does not upload scan payloads to a project backend or telemetry service. Its version lookup sends a request to the npm registry; header probes and script fallbacks request the inspected site.
- Files you explicitly export stay under your control. The extension does not upload those reports.

## Storage and retention

- Per-tab scan results and passive detection state are stored in `chrome.storage.session`; tab state is cleared on tab close or navigation start.
- PDF export temporarily places the scan result in `chrome.storage.session` for the report tab to retrieve and remove. If the report tab never loads, that handoff remains until extension session storage is cleared.
- The latest npm version is cached in `chrome.storage.local` with a 24-hour refresh interval.

## Your controls

- You control when scans and report exports run; passive detection and config interception run automatically on matching HTTP(S) pages.
- You can clear extension data via Chrome extension settings or uninstall the extension at any time.

## Contact

For privacy questions, open an issue in the project repository.
