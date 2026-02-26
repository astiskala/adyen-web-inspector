# Check Catalog

Last validated: 2026-02-26

This catalog is the documentation source of truth for checks registered in:

- `src/background/checks/index.ts`
- `src/shared/types.ts` (`CheckId`, `CheckCategory`)

## Totals

| Category            | Check count | Source modules                   |
| ------------------- | ----------: | -------------------------------- |
| `sdk-identity`      |           5 | `sdk-identity.ts`                |
| `version-lifecycle` |           2 | `sdk-version.ts`                 |
| `environment`       |           4 | `environment.ts`                 |
| `auth`              |           3 | `auth.ts`                        |
| `callbacks`         |           8 | `callbacks.ts`                   |
| `risk`              |           2 | `risk-module.ts`                 |
| `security`          |          13 | `security.ts`, `security-csp.ts` |
| `third-party`       |           4 | `third-party-scripts.ts`         |
| **Total**           |      **40** | `ALL_CHECKS`                     |

## Severity Model

- `pass`: requirement or recommendation is met.
- `info`: informational signal; no direct failure.
- `notice`: non-blocking improvement area or manual follow-up.
- `warn`: important risk or best-practice gap.
- `fail`: high-confidence issue requiring remediation.
- `skip`: check not applicable or insufficient data.

## Check Index

| Category            | Check ID                         | Validation goal                                                                                    | Possible severities              |
| ------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------- |
| `sdk-identity`      | `sdk-detected`                   | Detect Adyen Web SDK presence via metadata or script/resource signals.                             | `info`, `fail`                   |
| `sdk-identity`      | `sdk-flavor`                     | Identify integration flavor (`Drop-in`, `Components`, `Custom`, `unknown`) and evidence source.    | `info`                           |
| `sdk-identity`      | `sdk-import-method`              | Classify SDK loading method (`CDN`, `Adyen`, `NPM`).                                               | `info`                           |
| `sdk-identity`      | `sdk-bundle-type`                | Assess bundle type (`auto` vs optimised/tree-shakable) for non-CDN integrations.                   | `pass`, `warn`, `skip`           |
| `sdk-identity`      | `sdk-analytics`                  | Verify checkout analytics is not explicitly disabled (`analytics.enabled !== false`).              | `pass`, `warn`, `skip`           |
| `version-lifecycle` | `version-detected`               | Verify the inspector can determine the running `adyen-web` version.                                | `info`, `warn`                   |
| `version-lifecycle` | `version-latest`                 | Compare detected version with latest npm version and classify version drift.                       | `pass`, `notice`, `warn`, `skip` |
| `environment`       | `env-cdn-mismatch`               | Ensure CDN asset environment matches configured environment.                                       | `pass`, `fail`, `skip`           |
| `environment`       | `env-region`                     | Determine region from config/network evidence (or unknown/test skip).                              | `info`, `skip`                   |
| `environment`       | `env-key-mismatch`               | Ensure client key prefix environment aligns with observed API environment.                         | `pass`, `fail`, `skip`           |
| `environment`       | `env-not-iframe`                 | Warn if checkout is embedded inside an iframe.                                                     | `pass`, `warn`                   |
| `auth`              | `auth-client-key`                | Detect deprecated origin keys (`pub.v2.`) and enforce client-key usage.                            | `pass`, `warn`, `skip`           |
| `auth`              | `auth-country-code`              | Ensure `countryCode` is set in checkout config.                                                    | `pass`, `fail`, `skip`           |
| `auth`              | `auth-locale`                    | Validate `locale` is set and supported by Adyen Web translations.                                  | `pass`, `warn`, `skip`           |
| `callbacks`         | `flow-type`                      | Infer integration flow (`Sessions`, `Advanced`, `Unknown`) from runtime signals.                   | `info`                           |
| `callbacks`         | `callback-on-submit`             | Require `onSubmit` for Advanced flow.                                                              | `pass`, `fail`, `skip`           |
| `callbacks`         | `callback-on-additional-details` | Require `onAdditionalDetails` for Advanced flow follow-up actions (for example, 3DS).              | `pass`, `fail`, `skip`           |
| `callbacks`         | `callback-on-payment-completed`  | Verify payment-success outcome handling; stricter for Sessions flow.                               | `pass`, `fail`, `warn`, `skip`   |
| `callbacks`         | `callback-on-payment-failed`     | Verify payment-failure outcome handling; stricter for Sessions flow.                               | `pass`, `fail`, `warn`, `skip`   |
| `callbacks`         | `callback-on-error`              | Verify technical error handler is present.                                                         | `pass`, `fail`, `skip`           |
| `callbacks`         | `callback-before-submit`         | Detect optional `beforeSubmit` callback presence for custom pay-button setups.                     | `pass`, `info`, `skip`           |
| `callbacks`         | `callback-actions-pattern`       | Detect v6 `actions.resolve/reject` vs legacy v5 callback style in `onSubmit`.                      | `pass`, `warn`, `info`, `skip`   |
| `risk`              | `risk-df-iframe`                 | Detect Adyen risk device-fingerprint iframe/activity.                                              | `pass`, `warn`                   |
| `risk`              | `risk-module-not-disabled`       | Ensure `riskEnabled` is not explicitly set to `false`.                                             | `pass`, `warn`, `skip`           |
| `security`          | `security-https`                 | Enforce HTTPS on live environments.                                                                | `pass`, `fail`, `skip`           |
| `security`          | `security-sri-script`            | Ensure Adyen script tags include SRI attributes (`integrity`, `crossorigin`).                      | `pass`, `fail`, `skip`           |
| `security`          | `security-sri-css`               | Ensure Adyen stylesheet links include SRI attributes.                                              | `pass`, `warn`, `skip`           |
| `security`          | `security-referrer-policy`       | Validate recommended `Referrer-Policy` header posture.                                             | `pass`, `notice`                 |
| `security`          | `security-x-content-type`        | Validate `X-Content-Type-Options: nosniff`.                                                        | `pass`, `notice`                 |
| `security`          | `security-xss-protection`        | Confirm legacy `X-XSS-Protection` is absent or disabled.                                           | `pass`, `notice`                 |
| `security`          | `security-hsts`                  | Ensure HSTS is present on live environments.                                                       | `pass`, `notice`, `skip`         |
| `security`          | `security-iframe-referrerpolicy` | Check Adyen iframe `referrerpolicy` usage.                                                         | `pass`, `info`                   |
| `security`          | `security-csp-present`           | Require a CSP header.                                                                              | `pass`, `warn`                   |
| `security`          | `security-csp-script-src`        | Ensure CSP allows required Adyen script domains.                                                   | `pass`, `warn`, `skip`           |
| `security`          | `security-csp-frame-src`         | Ensure CSP iframe policy supports required 3DS iframe behavior.                                    | `pass`, `warn`, `skip`           |
| `security`          | `security-csp-frame-ancestors`   | Require anti-framing protection (`frame-ancestors` or `X-Frame-Options`).                          | `pass`, `warn`                   |
| `security`          | `security-csp-reporting`         | Validate CSP violation reporting configuration (`report-to`, `Reporting-Endpoints`, `report-uri`). | `pass`, `warn`, `info`           |
| `third-party`       | `3p-tag-manager`                 | Detect tag managers on checkout pages.                                                             | `pass`, `notice`                 |
| `third-party`       | `3p-session-replay`              | Detect session replay/screen recording tools on checkout pages.                                    | `pass`, `fail`                   |
| `third-party`       | `3p-ad-pixels`                   | Detect advertising/conversion pixels on checkout pages.                                            | `pass`, `warn`                   |
| `third-party`       | `3p-no-sri`                      | Ensure detected known third-party scripts use SRI.                                                 | `pass`, `notice`                 |

## Maintenance Checklist

When adding, removing, or renaming a check:

1. Update the check implementation in `src/background/checks/`.
2. Update `src/shared/types.ts` (`CheckId` and, if needed, `CheckCategory`).
3. Ensure `src/background/checks/index.ts` exports the check through `ALL_CHECKS`.
4. Add or update tests in `tests/unit/checks/`.
5. Update this catalog in the same pull request.
