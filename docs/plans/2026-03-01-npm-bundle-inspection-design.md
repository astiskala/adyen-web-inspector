# NPM Bundle Inspection via Preact Component Tree Extraction

## Problem

For NPM-bundled Adyen Web implementations, the config-interceptor's global property traps (`globalThis.AdyenCheckout`, `globalThis.AdyenWeb`) never fire because bundlers use ES module imports, not global assignments. This causes `checkoutConfig` to be `null`, making 16 checks skip entirely: all 10 callback checks, risk-module-not-disabled, sdk-analytics, sdk-multi-init, and partially auth-client-key/auth-country-code/auth-locale.

## Solution

Adyen Web SDK uses Preact internally. When a component mounts, Preact attaches a VNode tree to the mount-point DOM element via the `__k` property. Walking this tree exposes `props.core.options` — the complete checkout config including callbacks with source code.

### Why Preact tree walking

| Approach                              | Pro                                                                                    | Con                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Preact tree walk** (chosen)         | Works for all NPM bundles, CSP-safe (pure DOM property reads), full config + callbacks | Depends on Preact internal property names (`__k`, `__c`) |
| Patch `Element.prototype.appendChild` | Catches mount earlier                                                                  | Extremely invasive, performance risk                     |
| Enhanced Promise.prototype.then       | Already exists in config-interceptor                                                   | Banned by SonarQube (S2137)                              |
| MutationObserver then walk tree       | CSP-safe, decoupled from timing                                                        | Unnecessary complexity; retry loop handles timing        |

The `__k` and `__c` property names have been stable across all Preact X versions (used by Adyen Web 5.x and 6.x). Accepted as a reasonable dependency.

## Design

### New fields on `PageExtractResult`

```typescript
interface PageExtractResult {
  // ... existing fields ...
  /** Config extracted from mounted Adyen component Preact trees (NPM fallback). */
  readonly componentConfig: CheckoutConfig | null;
  /** Count of distinct mounted Adyen component trees found. */
  readonly componentMountCount?: number;
}
```

`componentConfig` sits alongside `checkoutConfig` and `inferredConfig` as a separate field. Each check decides which source to prefer.

`componentMountCount` replaces the broken `checkoutInitCount` for NPM (the global trap counter never fires for NPM).

### Preact tree walker algorithm (in page-extractor.ts)

1. **Find mount points**: Query `[class*="adyen-checkout"]` elements, check each `parentElement` for a `__k` VNode. Deduplicate.
2. **Walk VNode tree**: Recursively traverse `__k` (children) and check `__c` (component instance) for `props.core.options`.
3. **Extract fields**: From `core.options`, extract the same fields as config-interceptor — `clientKey`, `environment`, `locale`, `countryCode`, callback presence/source, `hasSession`, `analyticsEnabled`, `riskEnabled`.
4. **Merge mount points**: Multiple components share the same `core`, so first `core.options` found is the base. Component-level callbacks noted with `'component'` source.
5. **CSP safe**: Pure property reads on DOM elements and JS objects. No eval, no Function, no network requests.

### Check module consumption

Priority chain: `checkoutConfig` > `componentConfig` > `inferredConfig`.

A helper resolves the best available config:

```typescript
function resolveConfig(page: PageExtractResult): CheckoutConfig | null {
  return page.checkoutConfig ?? page.componentConfig ?? page.inferredConfig ?? null;
}
```

Checks needing callback source code check `checkoutConfig` first, then `componentConfig` (inferredConfig never has callbacks).

### Scan orchestrator update

The retry loop condition in `extractPageData()` currently only checks `checkoutConfig`. Update to also succeed when `componentConfig` is present.

## Files to modify

| File                                          | Change                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `src/shared/types.ts`                         | Add `componentConfig` and `componentMountCount` to `PageExtractResult` |
| `src/content/page-extractor.ts`               | Add `extractComponentConfig()` with Preact tree walker                 |
| `src/background/scan-orchestrator.ts`         | Update retry loop to check `componentConfig`                           |
| ~16 check modules in `src/background/checks/` | Fall through to `componentConfig` when `checkoutConfig` is null        |

## Files NOT modified

- `config-interceptor.ts` — untouched, continues to work for CDN
- `manifest.json` — no new content scripts (page-extractor already runs in MAIN world)
- `detector.ts` — detection is independent of config extraction

## Checks unlocked for NPM

- All 10 callback checks
- `risk-module-not-disabled`
- `sdk-analytics`
- `sdk-multi-init` (via `componentMountCount`)
- `auth-client-key`, `auth-country-code`, `auth-locale` (strengthened from partial inferredConfig to full data)
