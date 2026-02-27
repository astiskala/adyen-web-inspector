/**
 * MAIN-world config interceptor — injected at document_start before any page
 * scripts run.  It uses two complementary mechanisms to capture the Adyen Web
 * SDK (v6+) runtime configuration regardless of how the SDK was loaded:
 *
 * 1. **Global property traps** — when the SDK is loaded via CDN and sets
 *    `window.AdyenCheckout` (UMD) or `window.AdyenWeb` (ESM), the factory /
 *    component constructors are transparently wrapped for early capture.
 *
 * 2. **Promise.prototype.then interception** — the AdyenCheckout() factory
 *    always returns a Promise<Core>.  By wrapping `.then()` we detect the
 *    resolved instance by its shape and extract the full configuration.
 *    This works for both CDN and npm-bundled loads.
 *
 * The captured config is published on a well-known global for the
 * page-extractor to read.
 *
 * Design constraints:
 * - Must be completely self-contained (no runtime imports).
 * - Must not break the SDK or any merchant code.
 * - Must be idempotent — multiple injections are harmless.
 */

import type { CallbackSource, CheckoutConfig } from '../shared/types.js';

(function configInterceptor(): void {
  const CAPTURED_CONFIG_KEY = '__adyenWebInspectorCapturedConfig';
  const WRAPPED = '__awInspectorWrapped';

  type PlainRecord = Record<string, unknown>;

  /** Broad callable — we wrap arbitrary SDK exports whose shape is unknown. */
  type SdkCallable = (this: unknown, ...args: unknown[]) => unknown;

  const CALLBACK_KEYS = [
    'onSubmit',
    'onAdditionalDetails',
    'onPaymentCompleted',
    'onPaymentFailed',
    'onError',
    'beforeSubmit',
  ] as const;

  // Bail out if already injected (e.g. extension reinstall without full reload).
  if ((globalThis as PlainRecord)[CAPTURED_CONFIG_KEY + '__installed'] === true) {
    return;
  }
  (globalThis as PlainRecord)[CAPTURED_CONFIG_KEY + '__installed'] = true;

  // ---------------------------------------------------------------------------
  // Lightweight config normalisation
  // ---------------------------------------------------------------------------

  function hasCallback(value: unknown): boolean {
    return typeof value === 'boolean' ? value : typeof value === 'function';
  }

  function extractFields(raw: unknown, source: CallbackSource): Partial<CheckoutConfig> | null {
    if (raw === null || typeof raw !== 'object') return null;
    const r = raw as PlainRecord;
    const c: PlainRecord = {};

    if (typeof r['clientKey'] === 'string') c['clientKey'] = r['clientKey'];
    if (typeof r['environment'] === 'string') c['environment'] = r['environment'];
    if (typeof r['locale'] === 'string') c['locale'] = r['locale'];
    if (typeof r['countryCode'] === 'string') c['countryCode'] = r['countryCode'];

    if (typeof r['riskEnabled'] === 'boolean') c['riskEnabled'] = r['riskEnabled'];
    if (typeof r['riskEnabled'] === 'function') c['riskEnabled'] = true;

    const analytics = r['analytics'];
    if (typeof analytics === 'object' && analytics !== null) {
      const enabled = (analytics as PlainRecord)['enabled'];
      if (typeof enabled === 'boolean') c['analyticsEnabled'] = enabled;
    }

    if (r['session'] !== null && r['session'] !== undefined && typeof r['session'] === 'object') {
      c['hasSession'] = true;
    }

    // Tag each callback with its source ('checkout' or 'component').
    for (const key of CALLBACK_KEYS) {
      if (hasCallback(r[key])) c[key] = source;
    }

    // Capture onSubmit function body for callback-pattern checks.
    if (typeof r['onSubmit'] === 'function') {
      try {
        c['onSubmitSource'] = (r['onSubmit'] as () => void).toString().slice(0, 1200);
      } catch {
        /* toString may throw on bound/proxy functions */
      }
    }

    return Object.keys(c).length > 0 ? (c as Partial<CheckoutConfig>) : null;
  }

  // ---------------------------------------------------------------------------
  // Merge & publish
  // ---------------------------------------------------------------------------

  let captured: Partial<CheckoutConfig> | null = null;

  function mergeAndPublish(incoming: Partial<CheckoutConfig> | null): void {
    if (!incoming) return;

    if (captured) {
      // Never downgrade a callback from 'checkout' to 'component'.
      const safe = Object.fromEntries(
        Object.entries(incoming).filter(([k]) => {
          const isProtected =
            (CALLBACK_KEYS as readonly string[]).includes(k) &&
            captured?.[k as keyof typeof captured] === 'checkout';
          return !isProtected;
        })
      ) as Partial<CheckoutConfig>;
      captured = { ...captured, ...safe };
    } else {
      captured = incoming;
    }

    (globalThis as PlainRecord)[CAPTURED_CONFIG_KEY] = structuredClone(captured);
  }

  function captureConfig(raw: unknown, source: CallbackSource): void {
    mergeAndPublish(extractFields(raw, source));
  }

  // ---------------------------------------------------------------------------
  // Wrapping helpers
  // ---------------------------------------------------------------------------

  function isWrapped(fn: unknown): boolean {
    return typeof fn === 'function' && (fn as unknown as PlainRecord)[WRAPPED] === true;
  }

  function markWrapped(fn: SdkCallable): void {
    try {
      (fn as unknown as PlainRecord)[WRAPPED] = true;
    } catch {
      /* frozen or non-extensible */
    }
  }

  /** Copy static own properties (except built-ins) from original → wrapped. */
  function copyStatics(original: SdkCallable, wrapped: SdkCallable): void {
    for (const key of Object.getOwnPropertyNames(original)) {
      if (
        key === 'prototype' ||
        key === 'length' ||
        key === 'name' ||
        key === 'arguments' ||
        key === 'caller'
      ) {
        continue;
      }
      try {
        const desc = Object.getOwnPropertyDescriptor(original, key);
        if (desc) Object.defineProperty(wrapped, key, desc);
      } catch {
        /* non-configurable */
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Wrap the AdyenCheckout async factory (v6+)
  // ---------------------------------------------------------------------------

  function wrapCheckoutFactory(original: SdkCallable): SdkCallable {
    if (isWrapped(original)) return original;

    const wrapped: SdkCallable = function (this: unknown, ...args: unknown[]): unknown {
      // Capture the raw config eagerly — acts as a safety net if the SDK
      // promise rejects before Promise.then interception can fire.
      captureConfig(args[0], 'checkout');
      return original.apply(this, args);
    };

    markWrapped(wrapped);
    copyStatics(original, wrapped);
    return wrapped;
  }

  function captureInstanceConfig(instance: unknown): void {
    if (instance !== null && instance !== undefined && typeof instance === 'object') {
      const inst = instance as PlainRecord;
      captureConfig(inst['options'] ?? inst['_options'], 'checkout');
      wrapInstanceCreate(inst);
    }
  }

  /** Wrap `checkout.create()` so component-level config is also captured. */
  function wrapInstanceCreate(inst: PlainRecord | null): void {
    if (!inst) return;
    const originalCreate = inst['create'];
    if (typeof originalCreate !== 'function' || isWrapped(originalCreate)) return;

    const wrappedCreate = function (this: unknown, ...args: unknown[]): unknown {
      // checkout.create('card', componentConfig)
      if (args.length > 1) captureConfig(args[1], 'component');
      return originalCreate.apply(this, args);
    };

    markWrapped(wrappedCreate);
    inst['create'] = wrappedCreate;
  }

  // ---------------------------------------------------------------------------
  // Wrap component constructors (Card, Dropin, etc.)
  // ---------------------------------------------------------------------------

  function wrapComponentConstructor(original: SdkCallable): SdkCallable {
    if (isWrapped(original)) return original;

    const wrapped: SdkCallable = function (this: unknown, ...args: unknown[]): unknown {
      // Component pattern: new Component(checkout, config)
      if (args.length > 1) captureConfig(args[1], 'component');

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- new.target is runtime-only; TS types it as always-undefined
      return new.target !== undefined
        ? (Reflect.construct(original, args, original) as unknown)
        : original.apply(this, args);
    };

    markWrapped(wrapped);
    (wrapped as unknown as PlainRecord)['prototype'] = (original as unknown as PlainRecord)[
      'prototype'
    ];
    copyStatics(original, wrapped);
    return wrapped;
  }

  /** Walk all exports on the AdyenWeb namespace and wrap known patterns. */
  function instrumentAdyenWeb(ns: PlainRecord): void {
    for (const key of Object.keys(ns)) {
      const prop = ns[key];
      if (typeof prop !== 'function' || isWrapped(prop)) continue;

      if (key === 'AdyenCheckout') {
        ns[key] = wrapCheckoutFactory(prop as SdkCallable);
      } else {
        // Every other exported function is assumed to be a component
        // constructor (Card, Dropin, GooglePay, …).
        ns[key] = wrapComponentConstructor(prop as SdkCallable);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Install global property intercepts
  // ---------------------------------------------------------------------------

  // --- window.AdyenCheckout (SDK v6+ UMD) ---
  let storedAdyenCheckout: unknown;
  try {
    Object.defineProperty(globalThis, 'AdyenCheckout', {
      get() {
        return storedAdyenCheckout;
      },
      set(value: unknown) {
        storedAdyenCheckout =
          typeof value === 'function' && !isWrapped(value)
            ? wrapCheckoutFactory(value as SdkCallable)
            : value;
      },
      configurable: true,
      enumerable: true,
    });
  } catch {
    /* property may already be non-configurable */
  }

  // --- window.AdyenWeb (SDK v6+ ESM) ---
  let storedAdyenWeb: unknown;
  try {
    Object.defineProperty(globalThis, 'AdyenWeb', {
      get() {
        return storedAdyenWeb;
      },
      set(value: unknown) {
        if (value !== null && value !== undefined && typeof value === 'object') {
          instrumentAdyenWeb(value as PlainRecord);
        }
        storedAdyenWeb = value;
      },
      configurable: true,
      enumerable: true,
    });
  } catch {
    /* property may already be non-configurable */
  }

  // ---------------------------------------------------------------------------
  // Promise.prototype.then interception — captures Adyen Core instances
  // resolved from the AdyenCheckout() async factory.  The factory always
  // returns a Promise<Core>, so by wrapping .then() we can detect the
  // resolved instance by its shape and extract the full configuration.
  // This is the primary capture mechanism and works for both CDN and npm.
  // ---------------------------------------------------------------------------

  try {
    type PromiseThenFn = (
      this: Promise<unknown>,
      onFulfilled?: ((value: unknown) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null
    ) => Promise<unknown>;

    const origThen = Promise.prototype.then as unknown as PromiseThenFn;

    /**
     * Returns true when `value` looks like an Adyen Web Core / Checkout
     * instance produced by `await AdyenCheckout(config)`.
     *
     * Shape check — requires BOTH:
     *  1. `.options.clientKey` or `._options.clientKey` is a string
     *  2. At least one distinctive Core-instance property is present:
     *     `modules`, `paymentMethodsResponse`, `loadingContext`,
     *     `createFromAction`, or `create`.
     */
    function looksLikeCheckoutInstance(value: unknown): boolean {
      if (value === null || typeof value !== 'object') return false;
      const v = value as PlainRecord;

      const opts = v['options'] ?? v['_options'];
      if (
        opts === null ||
        opts === undefined ||
        typeof opts !== 'object' ||
        typeof (opts as PlainRecord)['clientKey'] !== 'string'
      ) {
        return false;
      }

      // Guard against matching plain config objects — require at least one
      // property that only exists on an *instantiated* Core object.
      return (
        'modules' in v ||
        'paymentMethodsResponse' in v ||
        'loadingContext' in v ||
        'createFromAction' in v ||
        typeof v['create'] === 'function'
      );
    }

    (Promise.prototype as unknown as PlainRecord)['then'] = function (
      this: Promise<unknown>,
      onFulfilled?: ((value: unknown) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null
    ): Promise<unknown> {
      if (typeof onFulfilled !== 'function') {
        return origThen.call(this, onFulfilled, onRejected);
      }
      const original = onFulfilled;
      return origThen.call(
        this,
        (value: unknown): unknown => {
          try {
            if (looksLikeCheckoutInstance(value)) {
              captureInstanceConfig(value);
            }
          } catch {
            /* never break promise chains */
          }
          return original(value);
        },
        onRejected
      );
    };
  } catch {
    /* non-configurable */
  }
})();
