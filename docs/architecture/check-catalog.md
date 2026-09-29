# Check Catalog

Last validated: 2026-09-29

This catalog documents the checks registered in:

- `src/background/checks/index.ts`
- `src/shared/types.ts` (`CheckId`, `CheckCategory`)

Each check implementation owns its outcomes and exceptional impact policy. Checks read checkout configuration through `readCheckoutField()` in `src/shared/scan-evidence.ts`, which reports each field as present, absent, or unobserved. A field is absent only when some inspected frame directly captured AdyenCheckout options (`checkoutConfigComplete`) and no source shows the field. CSP checks read the enforced policy through `readPagePolicy()` in `src/background/checks/page-policy.ts`. Checks read implementation attributes (integration flavor and flow, environment, region, import method, and checkout activity) from the runner context; the Scan derives them once per scan payload and stores the same record on the scan result. Callback checks read captured callback source through `src/background/checks/callback-source.ts`.

## Totals

| Category            | Check count | Source modules                         |
| ------------------- | ----------: | -------------------------------------- |
| `sdk-identity`      |           7 | `sdk-identity.ts`, `styling.ts`        |
| `version-lifecycle` |           5 | `sdk-version.ts`, `v6-deprecations.ts` |
| `environment`       |           5 | `environment.ts`                       |
| `auth`              |           4 | `auth.ts`                              |
| `callbacks`         |          12 | `callbacks.ts`                         |
| `risk`              |           3 | `risk-module.ts`                       |
| `security`          |          17 | `security.ts`, `security-csp.ts`       |
| `third-party`       |           5 | `third-party-scripts.ts`               |
| **Total**           |      **58** | `ALL_CHECKS`                           |

## Adyen Uplift Scope

The inspector assesses only browser-visible Uplift signals. It does not claim to verify server-side
or account-side requirements such as Checkout API request fields, webhooks, tokenization, 3D Secure
configuration, payment method ordering, or Customer Area settings.

Automated browser signals cover the co-badged card SDK minimum
(`uplift-cobadged-version`) and fraud data collection activity
(`risk-df-iframe`, `risk-module-not-disabled`).

## Severity Model

- `pass`: requirement or recommendation is met.
- `info`: informational signal; no direct failure.
- `notice`: non-blocking finding. Render as `Low impact` for automated recommendations, or `Manual verification` when human or PCI/compliance validation is still required. Every view takes these labels from `IMPACT_LABELS` in `src/shared/results.ts`.
- `warn`: important risk or best-practice gap.
- `fail`: high-confidence issue requiring remediation.
- `skip`: check not applicable or insufficient data.

## Notice Presentation

- `Low impact`: automated non-blocking recommendation with a clear remediation path. The check's `noticeImpact` policy records this.
- `Manual verification`: default for other `notice` outcomes. Use this when the extension cannot verify acceptability automatically, or when PCI/script-inventory review is still required.

Current low-impact notice checks:

- `sdk-bundle-type`
- `version-latest` (patch drift and recent minor drift paths)
- `security-referrer-policy`
- `security-x-content-type`
- `security-xss-protection`
- `security-hsts`
- `styling-css-custom-props`

Current manual-review notice checks:

- `env-not-iframe` (embedded with `redirectFromTopWhenInIframe`)
- `auth-country-code` (inferred-only value)
- `auth-locale` (inferred-only value)
- `callback-on-submit-filtering`
- `callback-on-submit-state-data` (truncated callback source)
- `callback-multiple-submissions`
- `risk-card-holder-name`
- `3p-tag-manager`
- `3p-no-sri`

## Check Index

| Category            | Check ID                                   | Validation goal                                                                                                                                  | Possible severities                      |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `sdk-identity`      | `sdk-detected`                             | Detect Adyen Web SDK presence via metadata or Adyen-hosted checkout script tags.                                                                 | `info`, `fail`                           |
| `sdk-identity`      | `sdk-flavor`                               | Identify integration flavor (`Drop-in`, `Components`, `Custom`, `unknown`) and evidence source.                                                  | `info`                                   |
| `sdk-identity`      | `sdk-import-method`                        | Classify visible Adyen-hosted loading (`CDN`, `Adyen`); otherwise report `Unknown` rather than assuming npm.                                     | `info`                                   |
| `sdk-identity`      | `sdk-bundle-type`                          | Assess bundle type (`auto` vs optimised/tree-shakable) for non-CDN integrations; `auto` is a low-impact notice.                                  | `pass`, `notice`, `skip`                 |
| `sdk-identity`      | `sdk-analytics`                            | Verify checkout analytics is not explicitly disabled (`analytics.enabled !== false`).                                                            | `pass`, `warn`, `skip`                   |
| `sdk-identity`      | `sdk-multi-init`                           | Warn if `AdyenCheckout` is initialised multiple times.                                                                                           | `pass`, `warn`, `skip`                   |
| `version-lifecycle` | `version-detected`                         | Verify the inspector can determine the running `adyen-web` version, and report which signal established it.                                      | `info`, `warn`                           |
| `version-lifecycle` | `version-latest`                           | Compare detected version with latest npm version; warn on releases older than 6 months, low-impact notice for patch or recent minor drift.       | `pass`, `notice`, `warn`, `skip`         |
| `version-lifecycle` | `uplift-cobadged-version`                  | Verify the Adyen Uplift v6.16.0 minimum for an active Drop-in/Components checkout; otherwise skip.                                               | `pass`, `fail`, `skip`                   |
| `environment`       | `env-cdn-mismatch`                         | Ensure CDN asset environment matches configured environment.                                                                                     | `pass`, `fail`, `skip`                   |
| `environment`       | `env-region-mismatch`                      | Ensure CDN asset region matches configured region.                                                                                               | `pass`, `warn`, `skip`                   |
| `environment`       | `env-region`                               | Determine region from config/network evidence (or unknown/test skip).                                                                            | `info`, `skip`                           |
| `environment`       | `env-key-mismatch`                         | Ensure client key prefix environment aligns with observed API environment.                                                                       | `pass`, `fail`, `skip`                   |
| `environment`       | `env-not-iframe`                           | Warn when checkout is embedded in a frame; request manual review when `redirectFromTopWhenInIframe` is enabled.                                  | `pass`, `warn`, `notice`                 |
| `auth`              | `auth-client-key`                          | Detect deprecated origin keys (`pub.v2.`) and enforce client-key usage.                                                                          | `pass`, `warn`, `skip`                   |
| `auth`              | `auth-client-key-rejected`                 | Fail when Adyen client-side endpoints return 401 or 403, which indicates an invalid client key or a missing allowed origin.                      | `pass`, `fail`, `skip`                   |
| `auth`              | `auth-country-code`                        | Check captured `countryCode`; incomplete or inferred-only config requires manual verification.                                                   | `pass`, `fail`, `warn`, `notice`, `skip` |
| `auth`              | `auth-locale`                              | Check captured `locale` against translations; incomplete or inferred-only config requires manual verification.                                   | `pass`, `warn`, `notice`, `skip`         |
| `callbacks`         | `flow-type`                                | Infer integration flow (`Sessions`, `Advanced`, `Unknown`) from runtime signals.                                                                 | `info`                                   |
| `callbacks`         | `callback-on-submit`                       | Require `onSubmit` for Advanced flow.                                                                                                            | `pass`, `fail`, `skip`                   |
| `callbacks`         | `callback-on-submit-filtering`             | Advanced flow: warn on apparent selective `onSubmit` filtering; otherwise indicate uncertainty or request manual review.                         | `warn`, `notice`, `info`, `skip`         |
| `callbacks`         | `callback-on-submit-state-data`            | Advanced flow: warn when `onSubmit` appears to forward only selected `state.data` fields instead of the complete object.                         | `pass`, `warn`, `notice`, `info`, `skip` |
| `callbacks`         | `callback-on-additional-details`           | Require `onAdditionalDetails` for Advanced flow follow-up actions (for example, 3DS).                                                            | `pass`, `fail`, `skip`                   |
| `callbacks`         | `callback-on-payment-completed`            | Verify payment-success outcome handling; stricter for Sessions flow.                                                                             | `pass`, `fail`, `warn`, `skip`           |
| `callbacks`         | `callback-on-payment-failed`               | Verify payment-failure outcome handling; stricter for Sessions flow.                                                                             | `pass`, `fail`, `warn`, `skip`           |
| `callbacks`         | `callback-on-error`                        | Verify technical error handler is present.                                                                                                       | `pass`, `fail`, `skip`                   |
| `callbacks`         | `callback-before-submit`                   | Detect optional `beforeSubmit` callback presence for custom pay-button setups.                                                                   | `pass`, `info`, `skip`                   |
| `callbacks`         | `callback-actions-pattern`                 | Detect v6 `actions.resolve/reject` vs legacy v5 callback style in `onSubmit`.                                                                    | `pass`, `warn`, `info`, `skip`           |
| `callbacks`         | `callback-multiple-submissions`            | Report a possible duplicate-submission guard from callback source, or request manual review; do not verify runtime behavior.                     | `info`, `notice`, `skip`                 |
| `callbacks`         | `callback-custom-pay-button-compatibility` | Detect custom pay button indicators with unsupported payment methods (PayPal, Klarna, Click to Pay).                                             | `pass`, `warn`, `skip`                   |
| `risk`              | `risk-df-iframe`                           | Detect Adyen risk device-fingerprint iframe/activity when checkout is active.                                                                    | `pass`, `warn`, `skip`                   |
| `risk`              | `risk-module-not-disabled`                 | Ensure browser risk data collection is not explicitly disabled with `risk.enabled` or legacy `riskEnabled`.                                      | `pass`, `warn`, `skip`                   |
| `risk`              | `risk-card-holder-name`                    | When a new-card form is rendered, check that it collects the cardholder name that 3DS2 requires for Visa and JCB.                                | `pass`, `notice`, `skip`                 |
| `security`          | `security-https`                           | Enforce HTTPS on live environments.                                                                                                              | `pass`, `fail`, `skip`                   |
| `security`          | `security-sri-script`                      | Ensure Adyen script tags include SRI attributes (`integrity`, `crossorigin`).                                                                    | `pass`, `fail`, `skip`                   |
| `security`          | `security-sri-css`                         | Ensure Adyen stylesheet links include SRI attributes.                                                                                            | `pass`, `warn`, `skip`                   |
| `security`          | `security-referrer-policy`                 | Validate recommended `Referrer-Policy` header posture.                                                                                           | `pass`, `notice`, `skip`                 |
| `security`          | `security-x-content-type`                  | Validate `X-Content-Type-Options: nosniff`.                                                                                                      | `pass`, `notice`, `skip`                 |
| `security`          | `security-xss-protection`                  | Confirm legacy `X-XSS-Protection` is absent or disabled.                                                                                         | `pass`, `notice`, `skip`                 |
| `security`          | `security-hsts`                            | Ensure HSTS is present on live environments.                                                                                                     | `pass`, `notice`, `skip`                 |
| `security`          | `security-iframe-referrerpolicy`           | Check Adyen iframe `referrerpolicy` usage.                                                                                                       | `pass`, `info`                           |
| `security`          | `security-api-key-exposed`                 | Detect Adyen API keys accidentally exposed in frontend code.                                                                                     | `pass`, `fail`                           |
| `security`          | `security-csp-present`                     | Require a CSP header when document response headers were captured.                                                                               | `pass`, `warn`, `skip`                   |
| `security`          | `security-csp-script-src`                  | Check each enforced CSP policy against observed Adyen checkout script URLs; skip when scripts or headers are unavailable.                        | `pass`, `warn`, `skip`                   |
| `security`          | `security-csp-frame-src`                   | Ensure each enforced CSP iframe policy, including an inherited `default-src`, allows HTTPS issuer 3DS iframes.                                   | `pass`, `warn`, `skip`                   |
| `security`          | `security-csp-connect-src`                 | Ensure CSP `connect-src` (or `default-src`) allows the Adyen Web API, analytics, and translation origins for the configured environment.         | `pass`, `warn`, `skip`                   |
| `security`          | `security-csp-img-src`                     | Ensure CSP `img-src` (or `default-src`) allows Adyen CDN payment method logos; blocked logos are a low-impact warning.                           | `pass`, `warn`, `skip`                   |
| `security`          | `security-csp-form-action`                 | Ensure an explicit CSP `form-action` allows HTTPS destinations for 3DS and POST redirect form submissions.                                       | `pass`, `warn`, `skip`                   |
| `security`          | `security-csp-frame-ancestors`             | Require anti-framing protection (`frame-ancestors` or `X-Frame-Options`).                                                                        | `pass`, `warn`, `skip`                   |
| `security`          | `security-csp-reporting`                   | Validate CSP violation reporting configuration (`report-to`, `Reporting-Endpoints`, `report-uri`).                                               | `pass`, `warn`, `info`, `skip`           |
| `third-party`       | `3p-tag-manager`                           | Detect tag managers on checkout pages for PCI script inventory and authorization review.                                                         | `pass`, `notice`                         |
| `third-party`       | `3p-session-replay`                        | Detect session replay/screen recording tools on checkout pages.                                                                                  | `pass`, `warn`                           |
| `third-party`       | `3p-ad-pixels`                             | Detect advertising/conversion pixels on checkout pages.                                                                                          | `pass`, `warn`                           |
| `third-party`       | `3p-no-sri`                                | Detect known third-party scripts missing SRI for PCI integrity review.                                                                           | `pass`, `notice`                         |
| `third-party`       | `3p-cookiebot-auto-blocking`               | Warn when Cookiebot auto-blocking could prevent Card or Drop-in card fields from loading.                                                        | `pass`, `warn`, `skip`                   |
| `sdk-identity`      | `styling-css-custom-props`                 | Detect CSS class overrides and recommend CSS custom properties for Adyen Web v6+ styling as a low-impact improvement.                            | `pass`, `notice`, `skip`                 |
| `version-lifecycle` | `v6-deprecated-properties`                 | On v6, detect deprecated config properties (`setStatusAutomatically`, `installmentOptions`, `showBrandsUnderCardNumber`, `showFormInstruction`). | `pass`, `warn`, `skip`                   |
| `version-lifecycle` | `v6-deprecated-callbacks`                  | On v6, detect deprecated event handlers (`onValid`, `onOrderCreated`, `onShippingChange`, `onShopperDetails`).                                   | `pass`, `warn`, `skip`                   |

## Maintenance Checklist

When adding, removing, or renaming a check:

1. Update the check implementation in `src/background/checks/`. Read checkout configuration with `readCheckoutField()`, CSP with `readPagePolicy()`, and implementation attributes from the runner context; ESLint rejects direct reads of the raw config slots and CSP primitives.
2. Update `src/shared/types.ts` (`CheckId` and, if needed, `CheckCategory`).
3. Ensure `src/background/checks/index.ts` exports the check through `ALL_CHECKS`.
4. Add or update tests in `tests/unit/checks/`.
5. Record exceptional warning or notice impact alongside the check with the `warnImpact` or `noticeImpact` policy passed to `registry.add()`.
6. Update this catalog in the same pull request.
