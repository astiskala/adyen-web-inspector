/**
 * MAIN-world config interceptor — injected at document_start before any page
 * scripts run.  It uses two complementary mechanisms to capture the Adyen Web
 * SDK (v6+) runtime configuration regardless of how the SDK was loaded:
 *
 * 1. **Global property traps** — when the SDK is loaded via CDN and sets
 *    `window.AdyenCheckout` (UMD) or `window.AdyenWeb` (ESM), the factory /
 *    component constructors are transparently wrapped for early capture.
 *
 * 2. **Factory promise resolution hook** — AdyenCheckout() returns a
 *    Promise<Core>. Wrapped factory calls attach a non-intrusive
 *    `.then()` observer that inspects the resolved instance shape and
 *    extracts full configuration.
 *
 * 3. **Fallback prototype traps** — for bundled SDKs where the factory is
 *    not exposed globally, we hook into Promise.prototype.then to catch
 *    the configuration as it resolves within private scopes.
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
  const STRING_CONFIG_KEYS = ['clientKey', 'environment', 'locale', 'countryCode'] as const;

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

  function copyStringConfigFields(source: PlainRecord, target: PlainRecord): void {
    for (const key of STRING_CONFIG_KEYS) {
      const value = source[key];
      if (typeof value === 'string') {
        target[key] = value;
      }
    }
  }

  function copyRiskEnabledField(source: PlainRecord, target: PlainRecord): void {
    const riskEnabled = source['riskEnabled'];
    if (typeof riskEnabled === 'boolean') {
      target['riskEnabled'] = riskEnabled;
      return;
    }
    if (typeof riskEnabled === 'function') {
      target['riskEnabled'] = true;
    }
  }

  function copyAnalyticsEnabledField(source: PlainRecord, target: PlainRecord): void {
    const analytics = source['analytics'];
    if (typeof analytics !== 'object' || analytics === null) {
      return;
    }

    const enabled = (analytics as PlainRecord)['enabled'];
    if (typeof enabled === 'boolean') {
      target['analyticsEnabled'] = enabled;
    }
  }

  function copySessionFlag(source: PlainRecord, target: PlainRecord): void {
    if (
      source['session'] !== null &&
      source['session'] !== undefined &&
      typeof source['session'] === 'object'
    ) {
      target['hasSession'] = true;
    }
  }

  function copyCallbackSources(
    sourceRecord: PlainRecord,
    target: PlainRecord,
    source: CallbackSource
  ): void {
    for (const key of CALLBACK_KEYS) {
      if (hasCallback(sourceRecord[key])) {
        target[key] = source;
      }
    }
  }

  function copyOnSubmitSource(source: PlainRecord, target: PlainRecord): void {
    const onSubmit = source['onSubmit'];
    if (typeof onSubmit !== 'function') {
      return;
    }

    try {
      target['onSubmitSource'] = (onSubmit as () => void).toString().slice(0, 1200);
    } catch {
      /* toString may throw on bound/proxy functions */
    }
  }

  function extractFields(raw: unknown, source: CallbackSource): Partial<CheckoutConfig> | null {
    if (raw === null || typeof raw !== 'object') return null;
    const r = raw as PlainRecord;
    const c: PlainRecord = {};

    copyStringConfigFields(r, c);
    copyRiskEnabledField(r, c);
    copyAnalyticsEnabledField(r, c);
    copySessionFlag(r, c);
    copyCallbackSources(r, c, source);
    copyOnSubmitSource(r, c);

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

    try {
      (globalThis as PlainRecord)[CAPTURED_CONFIG_KEY] = structuredClone(captured);
    } catch {
      /* ignore cloning errors */
    }
  }

  function captureConfig(raw: unknown, source: CallbackSource): void {
    try {
      mergeAndPublish(extractFields(raw, source));
    } catch {
      /* ignore capture errors */
    }
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
      // promise rejects before the resolution hook can fire.
      captureConfig(args[0], 'checkout');
      const result = original.apply(this, args);
      observeCheckoutFactoryResult(result);
      return result;
    };

    markWrapped(wrapped);
    copyStatics(original, wrapped);
    return wrapped;
  }

  function captureInstanceConfig(instance: unknown): void {
    if (instance !== null && instance !== undefined && typeof instance === 'object') {
      try {
        const inst = instance as PlainRecord;
        captureConfig(inst['options'] ?? inst['_options'], 'checkout');
        wrapInstanceCreate(inst);
      } catch {
        /* ignore */
      }
    }
  }

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
    try {
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

      return (
        'modules' in v ||
        'paymentMethodsResponse' in v ||
        'loadingContext' in v ||
        'createFromAction' in v ||
        typeof v['create'] === 'function'
      );
    } catch {
      return false;
    }
  }

  function observeCheckoutFactoryResult(result: unknown): void {
    if (!(result instanceof Promise)) {
      return;
    }

    result
      .then((value: unknown) => {
        if (looksLikeCheckoutInstance(value)) {
          captureInstanceConfig(value);
        }
      })
      .catch(() => {
        // Never break merchant promise chains if capture logic fails.
      });
  }

  /** Wrap `checkout.create()` so component-level config is also captured. */
  function wrapInstanceCreate(inst: PlainRecord | null): void {
    if (!inst) return;
    try {
      const originalCreate = inst['create'];
      if (typeof originalCreate !== 'function' || isWrapped(originalCreate)) return;

      const wrappedCreate = function (this: unknown, ...args: unknown[]): unknown {
        // checkout.create('card', componentConfig)
        if (args.length > 1) captureConfig(args[1], 'component');
        return originalCreate.apply(this, args);
      };

      markWrapped(wrappedCreate);
      inst['create'] = wrappedCreate;
    } catch {
      /* ignore */
    }
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
      if (new.target === undefined) {
        return original.apply(this, args);
      }
      return Reflect.construct(original, args, original) as unknown;
    };

    markWrapped(wrapped);
    try {
      (wrapped as unknown as PlainRecord)['prototype'] = (original as unknown as PlainRecord)[
        'prototype'
      ];
    } catch {
      /* ignore */
    }
    copyStatics(original, wrapped);
    return wrapped;
  }

  /** Walk all exports on the AdyenWeb namespace and wrap known patterns. */
  function instrumentAdyenWeb(ns: PlainRecord): void {
    for (const key of Object.keys(ns)) {
      try {
        const prop = ns[key];
        if (typeof prop !== 'function' || isWrapped(prop)) continue;

        if (key === 'AdyenCheckout') {
          ns[key] = wrapCheckoutFactory(prop as SdkCallable);
        } else {
          // Every other exported function is assumed to be a component
          // constructor (Card, Dropin, GooglePay, …).
          ns[key] = wrapComponentConstructor(prop as SdkCallable);
        }
      } catch {
        /* ignore */
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
  // Fallback Prototype Interception (for bundled/npm SDKs)
  // ---------------------------------------------------------------------------

  /**
   * Trap Promise.prototype.then to intercept the result of the (private)
   * AdyenCheckout factory call.
   */
  const originalThen = Promise.prototype.then;
  type ThenFn = <TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => Promise<TResult1 | TResult2>;

  try {
    (Promise.prototype as unknown as { then: ThenFn }).then = function <
      TResult1 = unknown,
      TResult2 = never,
    >(
      this: Promise<unknown>,
      onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      const wrappedOnFulfilled =
        typeof onFulfilled === 'function'
          ? function (value: unknown): TResult1 | PromiseLike<TResult1> {
              try {
                if (looksLikeCheckoutInstance(value)) {
                  captureInstanceConfig(value);
                }
              } catch {
                /* ignore capture errors to ensure reliability */
              }
              return onFulfilled(value);
            }
          : onFulfilled;

      return originalThen.call(this, wrappedOnFulfilled, onRejected) as Promise<
        TResult1 | TResult2
      >;
    };
  } catch {
    /* prototype may be non-writable in some environments */
  }
})();
