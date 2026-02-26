# Security Policy

## Scope

Adyen Web Inspector is a Chrome extension that performs analysis in the browser on the page you scan.

The extension does **not** send scan payloads to a project backend, analytics service, or third-party telemetry endpoint.

During scans, the extension can make network requests to:

- The scanned page URL (header probing)
- Same-host script URLs (bundle/config detection fallback)
- Adyen-related URLs observed during scanning (for local analysis only)
- `https://registry.npmjs.org/@adyen/adyen-web/latest` (latest SDK version check, cached in `chrome.storage.local` for 24 hours)

No merchant payment payloads, credentials, or checkout data are intentionally transmitted to a maintainer-controlled service.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

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

The extension requests `host_permissions: ["<all_urls>"]` because it needs to inspect arbitrary merchant checkout pages. This is the minimum permission set required for the `chrome.webRequest` and `chrome.scripting` APIs.

### Content Security

- The page-world extractor (`page-extractor.ts`) runs via `chrome.scripting.executeScript` with `world: "MAIN"` — it reads globals but does not modify the page DOM or inject any scripts.
- The passive detector (`detector.ts`) performs only a lightweight selector check and a single `window.AdyenWebMetadata` read.
- No `eval()`, `new Function()`, or `document.write()` is used anywhere in the codebase.
- CSP is not relaxed in the manifest — the extension runs with Chrome's default extension CSP.

### Storage

- Per-tab scan results are stored in `chrome.storage.session`.
- Latest npm version cache is stored in `chrome.storage.local` with a 24-hour TTL.

### Dependencies

- Production dependency: **Preact** only (3KB, well-audited).
- All other dependencies are dev-only (build tools, linters, test frameworks).
- `pnpm` strict hoisting prevents phantom dependencies.
