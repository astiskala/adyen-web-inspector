# String Centralization Design

**Date:** 2026-02-26
**Status:** Approved

## Problem

Check modules across `src/background/checks/` contain inline string literals throughout their `createRegistry()` chains — pass/fail/warn/info titles, detail explanations, remediation text, and docsUrls. At the same time, a shared `constants.ts` exists but is only partially used: some modules import constants from it, while others duplicate the same strings inline. This creates inconsistency, makes strings hard to audit, and blocks i18n.

## Approach

**Per-module `STRINGS` objects** — each check module gets a `const STRINGS = { ... } as const` block declared at the top of the file, before the `createRegistry()` call. All string literals for that module live there. `constants.ts` shrinks to only what genuinely crosses module boundaries.

## Module `STRINGS` Structure

### Naming convention

Keys follow `{CHECK_SUFFIX}_{OUTCOME}_{FIELD}`:

- `CHECK_SUFFIX`: check ID without category prefix (`auth-client-key` → `CLIENT_KEY`)
- `OUTCOME`: `PASS`, `FAIL`, `WARN`, `INFO`, `NOTICE`, `SKIP`
- `FIELD`: `TITLE`, `DETAIL`, `REMEDIATION`, `URL`

### Example

```ts
const STRINGS = {
  CLIENT_KEY_SKIP_TITLE: 'Client key check skipped.',
  CLIENT_KEY_PASS_TITLE: 'Client key (not an origin key) is in use.',
  CLIENT_KEY_WARN_TITLE: 'Origin key detected — migrate to a client key.',
  CLIENT_KEY_WARN_DETAIL: 'The value "…" starts with "pub.v2." indicating an origin key…',
  CLIENT_KEY_WARN_REMEDIATION: 'Generate a client key in the Adyen Customer Area…',
  CLIENT_KEY_WARN_URL: 'https://docs.adyen.com/…',
} as const;
```

### Repeated URLs within a module

If a URL is shared across multiple checks within the same module, it stays as a private module-level `const` that `STRINGS` entries reference:

```ts
const PCI_GUIDE_URL = 'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/';
const STRINGS = {
  HTTPS_FAIL_URL: PCI_GUIDE_URL,
  SRI_SCRIPT_FAIL_URL: PCI_GUIDE_URL,
} as const;
```

## What Stays in `constants.ts`

Only two entries survive — both genuinely shared across multiple modules:

```ts
export const SKIP_REASONS = {
  CHECKOUT_CONFIG_NOT_DETECTED: 'Checkout config not detected.',
} as const;

export const COMMON_DETAILS = {
  PCI_COMPLIANCE_NOTICE: 'This is required to maintain PCI compliance.',
} as const;
```

`SKIP_TITLES` is deleted entirely — every entry was only used in one module.

## What Moves Out of `constants.ts`

| Constant                                             | Destination                                     |
| ---------------------------------------------------- | ----------------------------------------------- |
| `SKIP_TITLES.VERSION_COMPARISON_SKIPPED`             | `sdk-version.ts` STRINGS                        |
| `SKIP_TITLES.CDN_ENVIRONMENT_CHECK_SKIPPED`          | `environment.ts` STRINGS                        |
| `SKIP_TITLES.KEY_ENVIRONMENT_MISMATCH_CHECK_SKIPPED` | `environment.ts` STRINGS                        |
| `SKIP_TITLES.HTTPS_CHECK_SKIPPED`                    | `security.ts` STRINGS                           |
| `SKIP_REASONS.SESSIONS_FLOW_DETECTED`                | `callbacks.ts` STRINGS                          |
| `SKIP_REASONS.ON_SUBMIT_SOURCE_NOT_AVAILABLE`        | `callbacks.ts` STRINGS                          |
| `SKIP_REASONS.NO_CSP_HEADER`                         | `security-csp.ts` STRINGS                       |
| `SKIP_REASONS.SDK_NOT_ACTIVE`                        | `sdk-identity.ts` STRINGS                       |
| `SKIP_REASONS.ADYEN_WEB_METADATA_NOT_AVAILABLE`      | `sdk-identity.ts` STRINGS                       |
| `SKIP_REASONS.NOT_A_LIVE_ENVIRONMENT`                | `security.ts` STRINGS                           |
| `SKIP_REASONS.NOT_REQUIRED_FOR_TEST`                 | `security.ts` STRINGS                           |
| `SKIP_REASONS.TEST_ENVIRONMENT`                      | deleted (unused)                                |
| `SKIP_REASONS.CLIENT_KEY_NOT_DETECTED`               | `auth.ts` STRINGS                               |
| `SKIP_REASONS.NO_ADYEN_CDN_SCRIPTS`                  | `security.ts` STRINGS (fix inline duplicate)    |
| `SKIP_REASONS.NO_ADYEN_CDN_STYLESHEETS`              | `security.ts` STRINGS (fix inline duplicate)    |
| `SKIP_REASONS.CONFIGURED_ENVIRONMENT_UNKNOWN`        | `environment.ts` STRINGS (fix inline duplicate) |
| `SKIP_REASONS.NO_ADYEN_CDN_REQUESTS`                 | `environment.ts` STRINGS (fix inline duplicate) |
| `SKIP_REASONS.UNABLE_TO_DETERMINE_ENVIRONMENT`       | `environment.ts` STRINGS (fix inline duplicate) |

## Special Cases

### Dynamic skip titles in `callbacks.ts`

Template literals like `` `${options.label} check skipped.` `` are computed values, not literals. They stay inline.

### `FLOW_DOCS` in `callbacks.ts`

A structured URL lookup table accessed programmatically (`FLOW_DOCS.sessions.callbacks[flavor]`). It is data, not a string constant, and stays as a module-level constant alongside `STRINGS`.

### `PCI_COMPLIANCE_MESSAGE` duplicates

Both `security.ts` and `security-csp.ts` define a local `PCI_COMPLIANCE_MESSAGE` constant with the same value as `COMMON_DETAILS.PCI_COMPLIANCE_NOTICE`. Both local constants are deleted; usages replaced with `COMMON_DETAILS.PCI_COMPLIANCE_NOTICE`.

## Files Affected

- `src/background/checks/constants.ts` — shrinks significantly
- `src/background/checks/auth.ts` — add STRINGS, remove inline literals
- `src/background/checks/callbacks.ts` — add STRINGS, remove inline literals (dynamic titles stay inline)
- `src/background/checks/environment.ts` — add STRINGS, remove inline literals
- `src/background/checks/risk-module.ts` — add STRINGS, remove inline literals
- `src/background/checks/sdk-identity.ts` — add STRINGS, remove inline literals
- `src/background/checks/sdk-version.ts` — add STRINGS, remove inline literals
- `src/background/checks/security.ts` — add STRINGS, fix inline duplicates of SKIP_REASONS
- `src/background/checks/security-csp.ts` — add STRINGS, remove local PCI_COMPLIANCE_MESSAGE
