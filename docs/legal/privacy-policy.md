# Privacy Policy

Last updated: 2026-02-26

Adyen Web Inspector is a browser extension that analyzes Adyen Web integrations on pages you choose to scan.

## What the extension processes

When you run a scan, the extension may process:

- Page URL and protocol
- Page-level checkout configuration values relevant to Adyen integration checks (for example `clientKey`, `environment`, `locale`, and callback flags)
- Script, stylesheet, and iframe metadata needed for security/config checks
- Response headers for the current page and Adyen-related requests
- Adyen checkout analytics request fields used for SDK identification (for example `flavor`, `version`, `buildType`, `locale`, `sessionId`)

## How data is used

Processed data is used only to generate scan findings, health scores, and remediation guidance inside the extension UI.

## Network requests made by the extension

The extension can make network requests to:

- The currently scanned page URL (header probing) and same-host script URLs (bundle/config fallback inspection)
- `https://registry.npmjs.org/@adyen/adyen-web/latest` to check the latest SDK version

Adyen-related requests made by the page are passively observed via `chrome.webRequest` for local analysis; the extension does not actively replay those requests.

## Data sharing

- No scan payload is sold or shared with third parties.
- No analytics/telemetry is sent by this project to a first-party analytics backend.

## Storage and retention

- Per-tab scan results are stored in `chrome.storage.session` and are cleared on tab close/navigation reset.
- Latest npm version cache is stored in `chrome.storage.local` for up to 24 hours.

## Your controls

- You control when scans run.
- You can clear extension data via Chrome extension settings or uninstall the extension at any time.

## Contact

For privacy questions, open an issue in the project repository.
