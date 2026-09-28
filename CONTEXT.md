# Domain Context — Adyen Web Inspector

This glossary names the browser-visible concepts used by Adyen Web Inspector. It is for coding agents choosing names and interpreting scan results, not a guide to the complete payment journey. The inspector is independent of Adyen and cannot verify server-side behavior, account settings, or whether a payment succeeds.

## Inspected integration

- **Adyen Web integration** — a merchant's browser-side use of the Adyen Web SDK to render checkout. The inspector observes the integration; it does not operate it.
- **Checkout page** — the inspected document where checkout may be rendered. Checkout can be in the top frame or an iframe; SDK code can also be loaded on a page without an active checkout.
- **SDK presence** — evidence that Adyen Web is loaded, such as SDK metadata or an Adyen checkout script. Presence does not establish that a checkout is mounted or in use.
- **Checkout activity** — observable signs of an active checkout, such as configuration, analytics, Adyen iframes, or checkout network traffic. It is distinct from SDK presence.
- **Integration flavor** — how the browser-side checkout is rendered: **Drop-in**, **Components**, **Custom**, or **Unknown**. Flavor is inferred from observed signals and is independent of integration flow.
- **Integration flow** — the inferred payment integration path: **Sessions**, **Advanced**, or **Unknown**. A session object, analytics session ID, or Sessions request indicates Sessions; otherwise observed checkout configuration can indicate Advanced. Unknown means the browser supplied insufficient evidence, not that a flow is absent.
- **Import method** — how SDK code appears to be loaded: Adyen **CDN**, another **Adyen-hosted script**, or **Unknown**. Visible script URLs can establish an Adyen-hosted source; the absence of one does not prove an npm import.
- **Checkout configuration** — browser-observable settings and callback registrations associated with AdyenCheckout or a mounted payment method. Configuration can be captured directly from checkout options, read from a mounted tree, or inferred from partial signals such as parsed JSON and requests. Only directly captured checkout options establish that a missing field was absent from those options; inferred values do not verify merchant settings.
- **Environment** — the test or live setting associated with checkout. The inspector may infer it from configuration, a client key prefix, or observed traffic; conflicting sources can produce an environment mismatch issue.
- **Region** — the geographic live endpoint associated with configuration or traffic. Test uses a global endpoint, so a live region is not assigned to a test integration.
- **SDK version** — the version believed to be running on the inspected page, inferred from available browser signals. The latest npm version is a comparison point, not the detected running version.

## Scan and outcomes

- **Scan** — an on-demand inspection of a browser tab. It collects page and network observations, assesses them with checks, and produces a time-stamped scan result. A scan is a snapshot, not continuous monitoring.
- **Scan evidence** — the browser-visible inputs to a scan: page extraction, checkout configuration, SDK metadata, analytics, requests, response headers, and version signals. Sources can be partial or missing; missing evidence is not proof that a merchant capability is absent.
- **Scan payload** (`ScanPayload`) — the assembled evidence snapshot passed to checks, including the inspected page, captured traffic, version information, and scan time.
- **Check** — a browser-visible question evaluated against a scan payload. Each check belongs to a category and yields one check result; the [check catalog](docs/architecture/check-catalog.md) owns the full check inventory and rule details.
- **Check result** (`CheckResult`) — a check's outcome, with a severity and an explanation; it may include detail, remediation, and documentation. A skipped result is still a check result.
- **Issue** — a check result with severity `fail`, `warn`, or `notice`. Passing, informational, and skipped results are not issues. A `notice` can call for manual review without asserting a verified failure.
- **Severity** — the kind of outcome: `pass` (met), `warn` (important risk), `fail` (high-confidence problem), `notice` (non-blocking improvement or manual review), `info` (observation), or `skip` (not applicable or insufficient evidence). Severity is distinct from impact grouping.
- **Impact grouping** — the presentation priority of an issue: high, medium, low, or manual. It is derived from severity and check-specific policy; manual review means acceptability cannot be established automatically.
- **Health score** — the percentage of scoreable checks that pass; `info`, `notice`, and `skip` do not contribute. Its current tiers are `critical` if any check fails, `issues` if none fail but some warn, and `excellent` otherwise. A score of 100 with no scoreable checks does not prove a healthy integration.
- **Scan result** (`ScanResult`) — the time-stamped outcome for a tab: the scan payload, all check results, the health score, and the Standard Drop-in frontend assessment. JSON and PDF reports present this result; they are not separate inspections.

## Named assessments

- **Standard Drop-in frontend assessment** — the browser-visible assessment of the detected SDK version, Sessions flow, and Drop-in flavor. A positive outcome covers only those signals; it is not a determination that the merchant meets the complete Standard integration requirements.
- **Adyen Uplift browser-visible assessment** — checks of observable Uplift signals such as the co-badged card SDK minimum and browser risk data collection. It cannot establish server-side or account-side Uplift requirements.
