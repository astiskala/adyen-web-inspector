# Live-site testing — 2026-09-29

Tested the unpacked 1.4.0 extension in the user's Chrome with computer/browser
automation. These were publicly deployed Adyen test checkouts, not production
payments. No payment was submitted, and no personal or card data was entered.
The coverage below is exploratory, not a claim that every check is correct.

## Scenarios exercised

| Site and scenario                                                                                                                | Observed result                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [MyStore checkout](https://www.mystoredemo.io/#/checkout), merchant bundles, Sessions Drop-in                                    | Scan completed; version `6.46.0-alpha.7c7199d`, test environment, Sessions and Drop-in identified. Risk-script false positives described below. |
| MyStore checkout → home → cart → checkout using in-page links                                                                    | Home showed no checkout. On returning, Drop-in visibly mounted but the popup still said “Adyen not detected”. Reproduced twice.                 |
| MyStore “Attempt Scan” after the navigation failure                                                                              | Scan completed and displayed the checkout results, providing a manual recovery path.                                                            |
| [Payment Checkout Components](https://paymentcheckout.dev/playgrounds/adyen/components/), single Card with secured-field iframes | Passive detection and scan succeeded; version 6.33.0, test environment, Sessions and Components identified.                                     |
| [Payment Checkout Drop-in](https://paymentcheckout.dev/playgrounds/adyen/dropin/), hosted SDK                                    | Passive detection and scan succeeded; version 6.33.0, test environment, Sessions and Drop-in identified.                                        |

The Payment Checkout pages initially showed an unconfigured placeholder, then
mounted checkout after their asynchronous session setup. Their actual SDK script
was `https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.33.0/adyen.js`.
The reported missing SRI on that SDK script is distinct from the MyStore false
positive. Other warnings and notices were not independently validated.

## Reproduced defects

### Checkout detection is lost on same-document navigation

The worker resets tab state on `chrome.tabs.onUpdated` with `status: loading`.
Chrome also emits this for hash navigation. Meanwhile, the detector suppresses
an unchanged checkout signal using `lastSentState`. This can leave the stored
state empty even though checkout remains mounted.

The offline browser reproduction in
[live-navigation.test.ts](../tests/e2e/live-navigation.test.ts) loads checkout,
waits until the startup retries finish, changes only the hash, and opens the
popup. The expected “Adyen Web SDK detected” message is missing. The test was
run without an expected-failure annotation first and failed at that assertion.

A fix should coordinate document navigation resets with detector reporting;
preserving an old scan for a different route would not be an adequate fix.
Also verify leaving checkout, returning after asynchronous mount, browser
back/forward, and actual document reloads.

The earlier reload workaround restored detection, but did not establish that
all detection failures were caused by an outdated loaded extension.

### Risk-data script is mistaken for an SDK asset

MyStore loads its application in merchant-hosted bundles and inserts this script:

```text
https://checkoutshopper-live.adyen.com/checkoutshopper/assets/js/datacollection/datacollection.js
```

The scanner incorrectly uses this auxiliary script as evidence for:

- A missing SDK SRI finding.
- A live CDN versus test checkout environment mismatch.
- An `Adyen` SDK import label, despite no observed Adyen-hosted SDK script.

The resource predicate in `shared/adyen-endpoint.ts` accepts the entire
`/checkoutshopper/` path. Environment and import attribution in
`shared/implementation-attributes.ts` also uses the host without establishing
that the resource is the SDK. A fix should distinguish SDK assets from risk
scripts, API calls, images, translations, and other auxiliary resources.

The three corresponding assertions in
[live-site-regressions.test.ts](../tests/integration/live-site-regressions.test.ts)
were run as ordinary tests first and failed with the observed false positives.
Two passing controls preserve recognition of the genuine hosted SDK for Card
Components and Drop-in, including its missing SRI finding.

## Running the reproductions

```sh
pnpm test:integration tests/integration/live-site-regressions.test.ts
pnpm build
pnpm exec playwright test tests/e2e/live-navigation.test.ts
```

The three known integration defects use `it.fails`; the browser defect uses
`test.fail` immediately before its final assertion. These execute the desired
behavior assertions rather than skipping them. Unexpected passes fail the run,
so remove the annotations when fixes land. A green suite with these annotations
does **not** mean the four defect assertions have been fixed.

Fixtures contain only minimal public resource URLs and synthetic configuration;
they do not retain live client keys, session data, payment details, or full page
captures. Production code is unchanged by this testing pass.
