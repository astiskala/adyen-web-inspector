<!-- markdownlint-disable -->

# NPM Bundle Inspection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract checkout configuration from NPM-bundled Adyen Web implementations by walking the Preact component tree, enabling 16 previously-skipped checks.

**Architecture:** Add a `extractComponentConfig()` function to `page-extractor.ts` that finds Adyen mount points in the DOM, walks Preact's VNode tree via `__k`/`__c` internal properties, and extracts `props.core.options` into a new `componentConfig` field on `PageExtractResult`. Update check modules to fall through to `componentConfig` when `checkoutConfig` is null.

**Tech Stack:** TypeScript, Vitest, Chrome Extension APIs (MAIN world script injection)

---

### Task 1: Add `componentConfig` and `componentMountCount` to types

**Files:**

- Modify: `src/shared/types.ts:161-177` (`PageExtractResult` interface)
- Modify: `tests/fixtures/makeScanPayload.ts:13-26` (`makePageExtract` factory)

**Step 1: Add the new fields to `PageExtractResult`**

In `src/shared/types.ts`, add two fields to the `PageExtractResult` interface after line 173 (`checkoutInitCount`):

```typescript
  /** Config extracted from mounted Adyen component Preact trees (works for NPM bundles). */
  readonly componentConfig: CheckoutConfig | null;
  /** Count of distinct mounted Adyen component trees found in the DOM. */
  readonly componentMountCount?: number;
```

**Step 2: Update `makePageExtract` fixture factory**

In `tests/fixtures/makeScanPayload.ts`, add `componentConfig: null,` to the defaults in `makePageExtract()` (after line 17, the `inferredConfig: null` line).

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: Errors in `page-extractor.ts` (missing `componentConfig` in return) — this is expected and will be fixed in Task 2.

**Step 4: Commit**

```
feat: add componentConfig and componentMountCount to PageExtractResult
```

---

### Task 2: Implement Preact tree walker in page-extractor

**Files:**

- Create: `src/shared/preact-tree-extractor.ts`
- Modify: `src/content/page-extractor.ts`

The core extraction logic is split into a shared module for testability. The DOM-touching mount-point discovery stays in page-extractor.

**Step 1: Create the shared Preact tree extractor module**

Create `src/shared/preact-tree-extractor.ts` with the pure functions that operate on plain objects (no DOM access):

```typescript
// src/shared/preact-tree-extractor.ts
import type { CheckoutConfig } from './types.js';

const MAX_SOURCE_LENGTH = 1200;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Recursively walks a Preact VNode tree to find `props.core.options`.
 * Returns the options object if found, or null.
 */
export function findCoreOptions(node: any, depth: number): any {
  if (!node || depth > 15) return null;

  if (node.__c) {
    const props = node.__c.props;
    if (props?.core?.options) {
      return props.core.options;
    }
  }

  const children = node.__k;
  if (Array.isArray(children)) {
    for (const child of children) {
      const result = findCoreOptions(child, depth + 1);
      if (result) return result;
    }
  } else if (children && typeof children === 'object') {
    return findCoreOptions(children, depth + 1);
  }

  return null;
}

/**
 * Extracts CheckoutConfig fields from a core.options object.
 */
export function extractFieldsFromOptions(options: any): CheckoutConfig {
  const config: Record<string, unknown> = {};

  if (typeof options.clientKey === 'string') config.clientKey = options.clientKey;
  if (typeof options.environment === 'string') config.environment = options.environment;
  if (typeof options.locale === 'string') config.locale = options.locale;
  if (typeof options.countryCode === 'string') config.countryCode = options.countryCode;

  if (options.risk !== undefined) {
    config.riskEnabled = options.risk?.enabled !== false;
  }
  if (options.analytics !== undefined) {
    config.analyticsEnabled = options.analytics?.enabled !== false;
  }

  if (options.session) {
    config.hasSession = true;
  }

  const callbackNames = [
    'onSubmit',
    'onAdditionalDetails',
    'onPaymentCompleted',
    'onPaymentFailed',
    'onError',
    'beforeSubmit',
  ] as const;

  for (const name of callbackNames) {
    if (typeof options[name] === 'function') {
      config[name] = 'checkout' as const;
    }
  }

  if (typeof options.onSubmit === 'function') {
    try {
      config.onSubmitSource = options.onSubmit.toString().substring(0, MAX_SOURCE_LENGTH);
    } catch {
      /* source unavailable */
    }
  }
  if (typeof options.beforeSubmit === 'function') {
    try {
      config.beforeSubmitSource = options.beforeSubmit.toString().substring(0, MAX_SOURCE_LENGTH);
    } catch {
      /* source unavailable */
    }
  }

  return config as CheckoutConfig;
}

/**
 * Merges two CheckoutConfig objects. Base values take precedence;
 * extra fills in undefined gaps.
 */
export function mergeConfigs(base: CheckoutConfig, extra: CheckoutConfig): CheckoutConfig {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && merged[key] === undefined) {
      merged[key] = value;
    }
  }
  return merged as CheckoutConfig;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

**Step 2: Update page-extractor to use the shared module**

Add the import and DOM-level extraction function to `page-extractor.ts`:

```typescript
import {
  findCoreOptions,
  extractFieldsFromOptions,
  mergeConfigs,
} from '../shared/preact-tree-extractor.js';
import type { CheckoutConfig } from '../shared/types.js';
```

Add before the `extract()` function:

```typescript
interface ComponentExtraction {
  config: CheckoutConfig | null;
  mountCount: number;
}

function extractComponentConfig(): ComponentExtraction {
  const adyenElements = document.querySelectorAll('[class*="adyen-checkout"]');
  const mountPoints = new Set<Element>();

  for (const el of adyenElements) {
    const parent = el.parentElement;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (parent && (parent as any).__k) {
      mountPoints.add(parent);
    }
  }

  if (mountPoints.size === 0) {
    return { config: null, mountCount: 0 };
  }

  let merged: CheckoutConfig | null = null;

  for (const mount of mountPoints) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vnode = (mount as any).__k;
    const options = findCoreOptions(vnode, 0);
    if (options) {
      const extracted = extractFieldsFromOptions(options);
      merged = merged ? mergeConfigs(merged, extracted) : extracted;
    }
  }

  return { config: merged, mountCount: mountPoints.size };
}
```

**Step 3: Update the `extract()` return value**

```typescript
function extract(): PageExtractResult {
  const g = globalThis as GlobalWithAdyen;
  const { config: componentConfig, mountCount } = extractComponentConfig();
  return {
    adyenMetadata: extractMetadata(g),
    checkoutConfig: extractCheckoutConfig(g),
    inferredConfig: extractInferredConfig(g),
    componentConfig,
    scripts: extractScripts(),
    links: extractLinks(),
    iframes: extractIframes(),
    observedRequests: extractObservedRequests(),
    ...(typeof g.__adyenWebInspectorCheckoutInitCount === 'number'
      ? { checkoutInitCount: g.__adyenWebInspectorCheckoutInitCount }
      : {}),
    ...(mountCount > 0 ? { componentMountCount: mountCount } : {}),
    isInsideIframe: globalThis.self !== globalThis.top,
    pageUrl: globalThis.location.href,
    pageProtocol: globalThis.location.protocol,
  };
}
```

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```
feat: add Preact tree walker to extract config from NPM bundles
```

---

### Task 3: Write unit tests for the Preact tree walker

**Files:**

- Create: `tests/unit/shared/preact-tree-extractor.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, it, expect } from 'vitest';
import {
  findCoreOptions,
  extractFieldsFromOptions,
  mergeConfigs,
} from '../../../src/shared/preact-tree-extractor';

describe('findCoreOptions', () => {
  it('returns null for null/undefined node', () => {
    expect(findCoreOptions(null, 0)).toBeNull();
    expect(findCoreOptions(undefined, 0)).toBeNull();
  });

  it('returns null when depth limit exceeded', () => {
    const node = { __c: { props: { core: { options: { clientKey: 'x' } } } } };
    expect(findCoreOptions(node, 16)).toBeNull();
  });

  it('finds core.options on a direct component node', () => {
    const options = { clientKey: 'test_KEY', environment: 'test' };
    const node = { __c: { props: { core: { options } } } };
    expect(findCoreOptions(node, 0)).toBe(options);
  });

  it('finds core.options nested in children array', () => {
    const options = { clientKey: 'test_KEY' };
    const node = {
      __k: [{ __k: null }, { __k: [{ __c: { props: { core: { options } } }, __k: null }] }],
    };
    expect(findCoreOptions(node, 0)).toBe(options);
  });

  it('finds core.options in single-child (non-array) __k', () => {
    const options = { environment: 'live' };
    const node = {
      __k: { __c: { props: { core: { options } } } },
    };
    expect(findCoreOptions(node, 0)).toBe(options);
  });

  it('skips nodes without __c', () => {
    const options = { clientKey: 'test_ABC' };
    const node = {
      __k: [
        { someOther: true },
        { __c: { props: { notCore: true } }, __k: null },
        { __c: { props: { core: { options } } }, __k: null },
      ],
    };
    expect(findCoreOptions(node, 0)).toBe(options);
  });

  it('returns null when no core.options exists anywhere', () => {
    const node = {
      __k: [{ __c: { props: { something: 'else' } }, __k: null }, { __k: [{ __k: null }] }],
    };
    expect(findCoreOptions(node, 0)).toBeNull();
  });
});

describe('extractFieldsFromOptions', () => {
  it('extracts string fields', () => {
    const result = extractFieldsFromOptions({
      clientKey: 'test_KEY123',
      environment: 'test',
      locale: 'en-US',
      countryCode: 'NL',
    });
    expect(result.clientKey).toBe('test_KEY123');
    expect(result.environment).toBe('test');
    expect(result.locale).toBe('en-US');
    expect(result.countryCode).toBe('NL');
  });

  it('ignores non-string values for string fields', () => {
    const result = extractFieldsFromOptions({
      clientKey: 123,
      environment: null,
    });
    expect(result.clientKey).toBeUndefined();
    expect(result.environment).toBeUndefined();
  });

  it('extracts riskEnabled from risk.enabled', () => {
    expect(extractFieldsFromOptions({ risk: { enabled: false } }).riskEnabled).toBe(false);
    expect(extractFieldsFromOptions({ risk: { enabled: true } }).riskEnabled).toBe(true);
    expect(extractFieldsFromOptions({ risk: {} }).riskEnabled).toBe(true);
  });

  it('does not set riskEnabled when risk is absent', () => {
    expect(extractFieldsFromOptions({}).riskEnabled).toBeUndefined();
  });

  it('extracts analyticsEnabled from analytics.enabled', () => {
    expect(extractFieldsFromOptions({ analytics: { enabled: false } }).analyticsEnabled).toBe(
      false
    );
    expect(extractFieldsFromOptions({ analytics: {} }).analyticsEnabled).toBe(true);
  });

  it('detects session presence', () => {
    expect(extractFieldsFromOptions({ session: { id: 's1' } }).hasSession).toBe(true);
    expect(extractFieldsFromOptions({}).hasSession).toBeUndefined();
  });

  it('detects callbacks and marks them as checkout source', () => {
    const result = extractFieldsFromOptions({
      onSubmit: () => {},
      onPaymentCompleted: () => {},
      onError: () => {},
    });
    expect(result.onSubmit).toBe('checkout');
    expect(result.onPaymentCompleted).toBe('checkout');
    expect(result.onError).toBe('checkout');
    expect(result.onPaymentFailed).toBeUndefined();
  });

  it('captures onSubmitSource from function toString', () => {
    const fn = (data: unknown) => {
      console.log(data);
    };
    const result = extractFieldsFromOptions({ onSubmit: fn });
    expect(result.onSubmitSource).toContain('console.log');
  });

  it('captures beforeSubmitSource from function toString', () => {
    const fn = (data: unknown) => {
      return data;
    };
    const result = extractFieldsFromOptions({ beforeSubmit: fn });
    expect(result.beforeSubmitSource).toContain('return data');
  });

  it('truncates long source to 1200 chars', () => {
    // Create a function with a very long body via a closure over a long string
    const longString = 'a]'.repeat(1000);
    const fn = () => {
      return longString;
    };
    const result = extractFieldsFromOptions({ onSubmit: fn });
    expect(result.onSubmitSource!.length).toBeLessThanOrEqual(1200);
  });
});

describe('mergeConfigs', () => {
  it('base values take precedence', () => {
    const result = mergeConfigs(
      { clientKey: 'base_KEY', environment: 'test' },
      { clientKey: 'extra_KEY', locale: 'en-US' }
    );
    expect(result.clientKey).toBe('base_KEY');
    expect(result.environment).toBe('test');
    expect(result.locale).toBe('en-US');
  });

  it('fills gaps from extra', () => {
    const result = mergeConfigs({ clientKey: 'key' }, { locale: 'nl-NL', countryCode: 'NL' });
    expect(result.locale).toBe('nl-NL');
    expect(result.countryCode).toBe('NL');
  });

  it('returns base unchanged when extra is empty', () => {
    const base = { clientKey: 'k', environment: 'live' };
    expect(mergeConfigs(base, {})).toEqual(base);
  });
});
```

**Step 2: Run tests**

Run: `pnpm test tests/unit/shared/preact-tree-extractor.test.ts`
Expected: All pass.

**Step 3: Commit**

```
test: add unit tests for Preact tree extractor
```

---

### Task 4: Update scan-orchestrator retry loop

**Files:**

- Modify: `src/background/scan-orchestrator.ts:191-210` (`extractPageData` function)

**Step 1: Update early-return and retry conditions**

Change line 193 from:

```typescript
if (first.checkoutConfig) return first;
```

to:

```typescript
if (first.checkoutConfig || first.componentConfig) return first;
```

Change line 206 from:

```typescript
if (latest.checkoutConfig) return latest;
```

to:

```typescript
if (latest.checkoutConfig || latest.componentConfig) return latest;
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```
feat: retry loop accepts componentConfig as success signal
```

---

### Task 5: Update `implementation-attributes.ts` shared utilities

**Files:**

- Modify: `src/shared/implementation-attributes.ts`

These shared functions are used by multiple checks and need `componentConfig` in their fallback chains.

**Step 1: Update `resolveEnvironment` (line 235)**

Insert after line 243 (the `envFromInferred` block):

```typescript
const envFromComponent = detectEnvironmentFromConfig(payload.page.componentConfig?.environment);
if (envFromComponent !== null) {
  return { env: envFromComponent, source: 'config' };
}
```

Also update the client key fallback at line 247 to include `componentConfig`:

```typescript
const envFromKey =
  detectEnvironmentFromClientKey(payload.page.checkoutConfig?.clientKey) ??
  detectEnvironmentFromClientKey(payload.page.componentConfig?.clientKey) ??
  detectEnvironmentFromClientKey(payload.page.inferredConfig?.clientKey);
```

**Step 2: Update `resolveRegion` (line 264)**

Insert after line 268 (the `inferredConfig` check):

```typescript
if (regionFromConfig === 'unknown') {
  regionFromConfig = detectRegionFromConfig(payload.page.componentConfig?.environment);
}
```

**Step 3: Update `collectIntegrationFlowSignals` (line 350)**

Update `hasSessionConfig` at line 355 to include `componentConfig`:

```typescript
    hasSessionConfig:
      Boolean(payload.page.checkoutConfig?.hasSession) ||
      Boolean(payload.page.componentConfig?.hasSession) ||
      Boolean(payload.page.inferredConfig?.hasSession),
```

Update `hasCheckoutConfig` at line 359 to include `componentConfig`:

```typescript
    hasCheckoutConfig:
      payload.page.checkoutConfig !== null || payload.page.componentConfig !== null,
```

**Step 4: Run existing tests**

Run: `pnpm test tests/unit/shared/implementation-attributes.test.ts`
Expected: All pass.

**Step 5: Commit**

```
feat: include componentConfig in environment/region/flow resolution
```

---

### Task 6: Update callback checks to use `componentConfig` fallback

**Files:**

- Modify: `src/background/checks/callbacks.ts`
- Modify: `tests/unit/checks/callbacks.test.ts`

All 10 callback checks use the same pattern: `const config = payload.page.checkoutConfig; if (!config) return skip(...)`. The fix is the same for all: `const config = payload.page.checkoutConfig ?? payload.page.componentConfig`.

**Step 1: Update the two helper functions**

In `runAdvancedRequiredCallbackCheck` (around line 219), change:

```typescript
const config = payload.page.checkoutConfig;
```

to:

```typescript
const config = payload.page.checkoutConfig ?? payload.page.componentConfig;
```

In `runFlowSensitiveOutcomeCallbackCheck` (around line 264), make the same change.

**Step 2: Update the 6 standalone callback checks**

Apply `?? payload.page.componentConfig` to each:

- `callback-on-submit-filtering` (around line 528)
- `callback-on-error` (around line 610)
- `callback-before-submit` (around line 636)
- `callback-actions-pattern` (around line 655)
- `callback-multiple-submissions` (around line 686)
- `callback-custom-pay-button-compatibility` (around line 711)

Each has: `const config = payload.page.checkoutConfig;`
Change to: `const config = payload.page.checkoutConfig ?? payload.page.componentConfig;`

**Step 3: Write new tests for componentConfig fallback**

Add tests in `tests/unit/checks/callbacks.test.ts`:

```typescript
describe('componentConfig fallback', () => {
  it('callback-on-error uses componentConfig when checkoutConfig is null', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        componentConfig: makeCheckoutConfig({ onError: 'checkout' }),
      }),
      capturedRequests: sessionsRequests,
    });
    const result = onError.run(payload);
    expect(result.severity).toBe('pass');
  });

  it('callback-on-payment-completed uses componentConfig when checkoutConfig is null', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        componentConfig: makeCheckoutConfig({ onPaymentCompleted: 'checkout' }),
      }),
      capturedRequests: sessionsRequests,
    });
    const result = onPaymentCompleted.run(payload);
    expect(result.severity).toBe('pass');
  });

  it('callback-on-submit uses componentConfig in advanced flow', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        componentConfig: makeCheckoutConfig({ onSubmit: 'checkout' }),
      }),
    });
    const result = onSubmit.run(payload);
    expect(result.severity).toBe('pass');
  });

  it('callback-before-submit uses componentConfig', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        componentConfig: makeCheckoutConfig({ beforeSubmit: 'checkout' }),
      }),
      capturedRequests: sessionsRequests,
    });
    const result = beforeSubmit.run(payload);
    expect(result.severity).not.toBe('skip');
  });
});
```

**Step 4: Run tests**

Run: `pnpm test tests/unit/checks/callbacks.test.ts`
Expected: All pass.

**Step 5: Commit**

```
feat: callback checks fall through to componentConfig for NPM bundles
```

---

### Task 7: Update auth checks to use `componentConfig` fallback

**Files:**

- Modify: `src/background/checks/auth.ts`
- Modify: `tests/unit/checks/auth.test.ts`

**Step 1: Update auth-client-key (around line 54)**

Change from:

```typescript
const clientKey = payload.page.checkoutConfig?.clientKey ?? payload.page.inferredConfig?.clientKey;
```

to:

```typescript
const clientKey =
  payload.page.checkoutConfig?.clientKey ??
  payload.page.componentConfig?.clientKey ??
  payload.page.inferredConfig?.clientKey;
```

**Step 2: Update auth-country-code (around line 71)**

Add `const component = payload.page.componentConfig;` after the existing `config` and `inferred` declarations. Add a pass check for `component?.countryCode` after the `inferred` check and before the null guard. Update the null guard to: `if (!config && !component)`.

**Step 3: Update auth-locale (around line 104)**

Add `component` declaration. Update locale resolution: `const locale = config?.locale ?? component?.locale ?? inferred?.locale;`. Update the null guard to: `if (!config && !component)`.

**Step 4: Write componentConfig fallback tests in `auth.test.ts`**

```typescript
describe('componentConfig fallback', () => {
  it('auth-client-key resolves from componentConfig', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        componentConfig: makeCheckoutConfig({ clientKey: 'test_COMPONENT' }),
      }),
    });
    const result = authClientKey.run(payload);
    expect(result.severity).toBe('pass');
  });

  it('auth-country-code resolves from componentConfig', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        componentConfig: makeCheckoutConfig({ countryCode: 'NL' }),
      }),
    });
    const result = authCountryCode.run(payload);
    expect(result.severity).toBe('pass');
  });

  it('auth-locale resolves from componentConfig', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        componentConfig: makeCheckoutConfig({ locale: 'nl-NL' }),
      }),
    });
    const result = authLocale.run(payload);
    expect(result.severity).toBe('pass');
  });
});
```

**Step 5: Run tests**

Run: `pnpm test tests/unit/checks/auth.test.ts`
Expected: All pass.

**Step 6: Commit**

```
feat: auth checks fall through to componentConfig for NPM bundles
```

---

### Task 8: Update risk-module check

**Files:**

- Modify: `src/background/checks/risk-module.ts`
- Modify: `tests/unit/checks/risk-module.test.ts`

**Step 1: Update config resolution (around line 50)**

Change: `const config = payload.page.checkoutConfig;`
To: `const config = payload.page.checkoutConfig ?? payload.page.componentConfig;`

**Step 2: Write test**

```typescript
it('uses componentConfig when checkoutConfig is null', () => {
  const payload = makeScanPayload({
    page: makePageExtract({
      componentConfig: makeCheckoutConfig({ riskEnabled: false }),
    }),
  });
  const result = riskModuleNotDisabled.run(payload);
  expect(result.severity).toBe('warn');
});
```

**Step 3: Run tests**

Run: `pnpm test tests/unit/checks/risk-module.test.ts`
Expected: All pass.

**Step 4: Commit**

```
feat: risk-module check falls through to componentConfig
```

---

### Task 9: Update sdk-identity checks

**Files:**

- Modify: `src/background/checks/sdk-identity.ts`
- Modify: `tests/unit/checks/sdk-identity.test.ts`

**Step 1: Update sdk-analytics (around line 145)**

Change:

```typescript
if (payload.page.checkoutConfig?.analyticsEnabled === false) {
```

to:

```typescript
if (
  (payload.page.checkoutConfig ?? payload.page.componentConfig)?.analyticsEnabled ===
  false
) {
```

**Step 2: Update sdk-multi-init (around line 164)**

Change:

```typescript
const { checkoutInitCount } = payload.page;
if (checkoutInitCount === undefined || checkoutInitCount === 0) {
```

to:

```typescript
const initCount =
  payload.page.checkoutInitCount ?? payload.page.componentMountCount;
if (initCount === undefined || initCount === 0) {
```

Update the remaining references to `checkoutInitCount` in that check to use `initCount`.

**Step 3: Write tests**

```typescript
it('sdk-analytics detects disabled analytics from componentConfig', () => {
  const payload = makeScanPayload({
    page: makePageExtract({
      adyenMetadata: makeAdyenMetadata(),
      componentConfig: makeCheckoutConfig({ analyticsEnabled: false }),
    }),
  });
  const result = sdkAnalytics.run(payload);
  expect(result.severity).toBe('warn');
});

it('sdk-multi-init uses componentMountCount when checkoutInitCount is absent', () => {
  const payload = makeScanPayload({
    page: makePageExtract({
      adyenMetadata: makeAdyenMetadata(),
      componentMountCount: 2,
    }),
  });
  const result = sdkMultiInit.run(payload);
  expect(result.severity).toBe('warn');
});

it('sdk-multi-init passes with componentMountCount of 1', () => {
  const payload = makeScanPayload({
    page: makePageExtract({
      adyenMetadata: makeAdyenMetadata(),
      componentMountCount: 1,
    }),
  });
  const result = sdkMultiInit.run(payload);
  expect(result.severity).toBe('pass');
});
```

**Step 4: Run tests**

Run: `pnpm test tests/unit/checks/sdk-identity.test.ts`
Expected: All pass.

**Step 5: Commit**

```
feat: sdk-identity checks use componentConfig/componentMountCount
```

---

### Task 10: Update environment checks

**Files:**

- Modify: `src/background/checks/environment.ts`
- Modify: `tests/unit/checks/environment.test.ts`

**Step 1: Update env-key-mismatch (around line 115)**

Change:

```typescript
const clientKey = payload.page.checkoutConfig?.clientKey ?? payload.page.inferredConfig?.clientKey;
```

to:

```typescript
const clientKey =
  payload.page.checkoutConfig?.clientKey ??
  payload.page.componentConfig?.clientKey ??
  payload.page.inferredConfig?.clientKey;
```

**Step 2: Write test**

```typescript
it('env-key-mismatch resolves clientKey from componentConfig', () => {
  const payload = makeScanPayload({
    page: makePageExtract({
      componentConfig: makeCheckoutConfig({ clientKey: 'test_COMPONENT' }),
    }),
    capturedRequests: [makeRequest('https://checkoutshopper-test.adyen.com/foo')],
  });
  const result = envKeyMismatch.run(payload);
  expect(result.severity).toBe('pass');
});
```

**Step 3: Run tests**

Run: `pnpm test tests/unit/checks/environment.test.ts`
Expected: All pass.

**Step 4: Commit**

```
feat: env-key-mismatch check uses componentConfig fallback
```

---

### Task 11: Run full validation

**Step 1: Run full validate**

Run: `pnpm validate`
Expected: All checks pass — typecheck, lint, format, depcruise, knip, test coverage.

**Step 2: Fix any issues**

Address lint, coverage, or unused-export errors as needed.

**Step 3: Commit any fixes**

```
chore: fix lint/coverage issues from componentConfig changes
```

---

### Task 12: Manual E2E validation against localhost:3000

**Step 1: Build the extension**

Run: `pnpm build`

**Step 2: Test against localhost:3000**

Load the built extension in Chrome, navigate to `http://localhost:3000/`, trigger a scan. Verify:

- `componentConfig` is populated with `clientKey: 'test_73KJZLA5WZFNJHIHSB2YCII2ZA6CO27V'`, `environment: 'test'`, `locale: 'en-US'`, callbacks
- All callback checks now produce results (not skip)
- `componentMountCount` is `1`

**Step 3: Verify CSP compatibility**

Test against a page with strict CSP headers to confirm the Preact tree walker works (it should — it's pure property reads, no eval/inline scripts).
