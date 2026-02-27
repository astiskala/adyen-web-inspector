# Security Policy

## Scope

Adyen Web Inspector is a Chrome extension that performs analysis in the browser on the page you scan.

The extension does **not** send scan payloads to a project backend, analytics service, or third-party telemetry endpoint.

During scans, the extension can make network requests to:

- The scanned page URL (header probing via `HEAD`/`GET`)
- Same-host script URLs (bundle/config detection fallback)
- `https://registry.npmjs.org/@adyen/adyen-web/latest` (latest SDK version check, cached in `chrome.storage.local` for 24 hours)

In addition to those extension-initiated requests, Adyen network traffic triggered by the page is passively observed via `chrome.webRequest` for local analysis.

No merchant payment payloads, credentials, or checkout data are intentionally transmitted to a maintainer-controlled service.

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Email the maintainer directly at the address listed in the repository profile, or use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) feature.
3. Include:
   - A description of the vulnerability
   - Steps to reproduce
   - The potential impact
   - A suggested fix (if you have one)

You should receive an acknowledgement within 48 hours. A fix will be prioritised based on severity.

## Security Design Decisions

### Permissions

The extension requests `host_permissions: ["<all_urls>"]` because it needs to inspect arbitrary merchant checkout pages. This is required by the current design, which uses `chrome.webRequest` and `chrome.scripting` across any scanned checkout origin.

### Content Security

- The config interceptor (`config-interceptor.ts`) runs as a MAIN-world content script at `document_start`. It installs lightweight property traps on `window.AdyenCheckout` / `window.AdyenWeb` and wraps `Promise.prototype.then` to detect SDK initialisation by object shape. It does not modify the DOM, inject scripts, or make network calls.
- The page-world extractor (`page-extractor.ts`) runs via `chrome.scripting.executeScript` with `world: "MAIN"` — it reads globals but does not modify the page DOM or inject any scripts.
- The passive detector (`detector.ts`) uses lightweight DOM selectors and route/mutation listeners to detect checkout mounts; it does not execute remote code or make network calls.
- No `eval()`, `new Function()`, or `document.write()` is used anywhere in the codebase.
- CSP is not relaxed in the manifest — the extension runs with Chrome's default extension CSP.

### Storage

- Per-tab scan results are stored in `chrome.storage.session`.
- Latest npm version cache is stored in `chrome.storage.local` with a 24-hour TTL.

### Dependencies

- Production dependency: **Preact** only (3KB, well-audited).
- All other dependencies are dev-only (build tools, linters, test frameworks).
- `pnpm` strict hoisting prevents phantom dependencies.
