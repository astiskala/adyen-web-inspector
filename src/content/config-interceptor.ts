/**
 * MAIN-world config interceptor — injected at document_start before any page
 * scripts run. It uses several complementary mechanisms to capture the Adyen Web
 * SDK runtime configuration:
 *
 * 1. **Global property traps** — for UMD/ESM CDN loads that expose
 *    `AdyenCheckout` or `AdyenWeb`.
 *
 * 2. **Network interception (fetch/XHR)** — for all integrations (including
 *    bundled/NPM), we intercept SDK initialization requests to extract
 *    configuration fields like clientKey and environment.
 *
 * 3. **JSON bootstrapping** — we intercept JSON.parse to find large objects
 *    that look like Adyen configurations.
 *
 * The captured config is published on a well-known global for the
 * page-extractor to read.
 */

import type { CallbackSource, CheckoutConfig } from '../shared/types.js';

(function configInterceptor(): void {
  const CAPTURED_CONFIG_KEY = '__adyenWebInspectorCapturedConfig';
  const CAPTURED_INFERRED_CONFIG_KEY = '__adyenWebInspectorCapturedInferredConfig';
  const CAPTURED_INIT_COUNT_KEY = '__adyenWebInspectorCheckoutInitCount';
  const WRAPPED = '__awInspectorWrapped';

  type PlainRecord = Record<string, unknown>;
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
  const ADYEN_INSTANCE_MARKER = '__adyenInstance';

  if ((globalThis as PlainRecord)[CAPTURED_CONFIG_KEY + '__installed'] === true) {
    return;
  }
  (globalThis as PlainRecord)[CAPTURED_CONFIG_KEY + '__installed'] = true;

  // ---------------------------------------------------------------------------
  // Configuration extraction
  // ---------------------------------------------------------------------------

  function hasCallback(value: unknown): boolean {
    return typeof value === 'boolean' ? value : typeof value === 'function';
  }

  function copyStringFields(source: PlainRecord, target: PlainRecord): void {
    for (const key of STRING_CONFIG_KEYS) {
      if (typeof source[key] === 'string') {
        target[key] = source[key];
      }
    }
  }

  function copyRiskFields(source: PlainRecord, target: PlainRecord): void {
    const risk = source['riskEnabled'];
    if (typeof risk === 'boolean') {
      target['riskEnabled'] = risk;
    } else if (typeof risk === 'function') {
      target['riskEnabled'] = true;
    }
  }

  function copyAnalyticsFields(source: PlainRecord, target: PlainRecord): void {
    if (typeof source['analytics'] === 'object' && source['analytics'] !== null) {
      const enabled = (source['analytics'] as PlainRecord)['enabled'];
      if (typeof enabled === 'boolean') {
        target['analyticsEnabled'] = enabled;
      }
    }
  }

  function copySessionFields(source: PlainRecord, target: PlainRecord): void {
    if (
      source['session'] !== null &&
      source['session'] !== undefined &&
      typeof source['session'] === 'object'
    ) {
      target['hasSession'] = true;
    }
  }

  function extractFields(raw: unknown, source: CallbackSource): Partial<CheckoutConfig> | null {
    if (raw === null || typeof raw !== 'object') {
      return null;
    }
    const r = raw as PlainRecord;
    const c: PlainRecord = {};

    copyStringFields(r, c);
    copyRiskFields(r, c);
    copyAnalyticsFields(r, c);
    copySessionFields(r, c);

    for (const key of CALLBACK_KEYS) {
      if (hasCallback(r[key])) {
        c[key] = source;
      }
    }

    if (typeof r['onSubmit'] === 'function') {
      try {
        c['onSubmitSource'] = (r['onSubmit'] as () => void).toString().slice(0, 1200);
      } catch {
        /* ignore */
      }
    }

    if (typeof r['beforeSubmit'] === 'function') {
      try {
        c['beforeSubmitSource'] = (r['beforeSubmit'] as () => void).toString().slice(0, 1200);
      } catch {
        /* ignore */
      }
    }

    return Object.keys(c).length > 0 ? (c as Partial<CheckoutConfig>) : null;
  }

  // ---------------------------------------------------------------------------
  // Merging & Publishing
  // ---------------------------------------------------------------------------

  let captured: Partial<CheckoutConfig> | null = null;
  let inferred: Partial<CheckoutConfig> | null = null;

  function mergeAndPublish(incoming: Partial<CheckoutConfig> | null): void {
    if (incoming === null) {
      return;
    }

    if (captured === null) {
      captured = incoming;
    } else {
      const safe = Object.fromEntries(
        Object.entries(incoming).filter(([k]) => {
          const isProtected =
            (CALLBACK_KEYS as readonly string[]).includes(k) &&
            captured?.[k as keyof typeof captured] === 'checkout';
          return !isProtected;
        })
      ) as Partial<CheckoutConfig>;
      captured = { ...captured, ...safe };
    }

    try {
      (globalThis as PlainRecord)[CAPTURED_CONFIG_KEY] = structuredClone(captured) as PlainRecord;
    } catch {
      /* ignore */
    }
  }

  function mergeAndPublishInferred(incoming: Partial<CheckoutConfig> | null): void {
    if (incoming === null) {
      return;
    }

    if (inferred === null) {
      inferred = incoming;
    } else {
      inferred = { ...inferred, ...incoming };
    }

    try {
      (globalThis as PlainRecord)[CAPTURED_INFERRED_CONFIG_KEY] = structuredClone(
        inferred
      ) as PlainRecord;
    } catch {
      /* ignore */
    }
  }

  function captureConfig(raw: unknown, source: CallbackSource): void {
    try {
      mergeAndPublish(extractFields(raw, source));
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------------
  // Discovery via Network & JSON
  // ---------------------------------------------------------------------------

  function tryCaptureFromUrl(url: string): void {
    try {
      const u = new URL(url, globalThis.location.href);
      const isAdyenDomain =
        u.hostname === 'adyen.com' ||
        u.hostname.endsWith('.adyen.com') ||
        u.hostname === 'adyenpayments.com' ||
        u.hostname.endsWith('.adyenpayments.com');
      if (!isAdyenDomain) {
        return;
      }

      const liveMatch = new RegExp(/(?:^|\.|-)(live(?:-[a-z]{2,4})?)(?:\.|$)/).exec(u.hostname);
      const testMatch = new RegExp(/(?:^|\.|-)(test)(?:\.|$)/).exec(u.hostname);

      if (liveMatch !== null) {
        const liveEnv = liveMatch[1];
        if (liveEnv !== undefined) {
          mergeAndPublishInferred({ environment: liveEnv });
        }
      } else if (testMatch !== null) {
        mergeAndPublishInferred({ environment: 'test' });
      }

      const clientKey = u.searchParams.get('clientKey');
      if (clientKey !== null && clientKey !== '') {
        mergeAndPublishInferred({ clientKey });
      }

      const localeFromParams = u.searchParams.get('locale');
      if (localeFromParams !== null && localeFromParams !== '') {
        mergeAndPublishInferred({ locale: localeFromParams });
      }

      const countryCode = u.searchParams.get('countryCode');
      if (countryCode !== null && countryCode !== '') {
        mergeAndPublishInferred({ countryCode });
      }

      const translationMatch = /\/translations\/([^/]+)\.json$/.exec(u.pathname);
      const localeFromUrl = translationMatch?.[1];
      if (typeof localeFromUrl === 'string' && localeFromUrl !== '') {
        mergeAndPublishInferred({ locale: localeFromUrl });
      }
    } catch {
      /* ignore */
    }
  }

  const originalParse = JSON.parse;
  JSON.parse = function (
    text: string,
    reviver?: (this: unknown, key: string, value: unknown) => unknown
  ): unknown {
    const result = originalParse.call(JSON, text, reviver) as unknown;
    if (result !== null && typeof result === 'object') {
      captureConfig(result, 'checkout');
    }
    return result;
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (typeof input === 'string') {
      tryCaptureFromUrl(input);
    } else if (input instanceof URL) {
      tryCaptureFromUrl(input.toString());
    } else if (input instanceof Request) {
      tryCaptureFromUrl(input.url);
    }

    return originalFetch.call(globalThis, input, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...args: unknown[]
  ): void {
    const u = typeof url === 'string' ? url : url.toString();
    tryCaptureFromUrl(u);

    try {
      const openArgs = [method, url, ...args] as [string, string | URL, boolean, string?, string?];
      return originalOpen.apply(this, openArgs);
    } catch {
      /* ignore */
    }
  };

  // ---------------------------------------------------------------------------
  // Global Property Traps (UMD/ESM)
  // ---------------------------------------------------------------------------

  function isWrapped(fn: unknown): boolean {
    return typeof fn === 'function' && (fn as unknown as PlainRecord)[WRAPPED] === true;
  }

  function markWrapped(fn: SdkCallable): void {
    try {
      (fn as unknown as PlainRecord)[WRAPPED] = true;
    } catch {
      /* ignore */
    }
  }

  function copyStatics(original: SdkCallable, wrapped: SdkCallable): void {
    for (const key of Object.getOwnPropertyNames(original)) {
      if (['prototype', 'length', 'name', 'arguments', 'caller'].includes(key)) {
        continue;
      }
      try {
        const desc = Object.getOwnPropertyDescriptor(original, key);
        if (desc !== undefined) {
          Object.defineProperty(wrapped, key, desc);
        }
      } catch {
        /* ignore */
      }
    }
  }

  function wrapInstanceCreate(i: PlainRecord): void {
    const create = i['create'];
    if (typeof create === 'function' && !isWrapped(create)) {
      const origCreate = create as SdkCallable;
      const wrappedCreate = function (this: unknown, ...cArgs: unknown[]): unknown {
        if (cArgs.length > 1) {
          captureConfig(cArgs[1], 'component');
        }
        return origCreate.apply(this, cArgs);
      };
      markWrapped(wrappedCreate);
      i['create'] = wrappedCreate;
    }
  }

  function tryCaptureFromInstance(inst: unknown): boolean {
    if (inst === null || typeof inst !== 'object') {
      return false;
    }

    const i = inst as PlainRecord;
    // Heuristic: looks like an Adyen Checkout instance
    const hasCreate = typeof i['create'] === 'function';
    const opts = i['options'] ?? i['_options'];
    const hasOptions = opts !== undefined && opts !== null && typeof opts === 'object';

    if (hasCreate && hasOptions) {
      if (i[ADYEN_INSTANCE_MARKER] === true) {
        return true;
      }
      try {
        i[ADYEN_INSTANCE_MARKER] = true;
      } catch {
        /* ignore */
      }

      captureConfig(opts, 'checkout');
      wrapInstanceCreate(i);
      return true;
    }

    return false;
  }

  function incrementInitCount(): void {
    try {
      const count = (globalThis as PlainRecord)[CAPTURED_INIT_COUNT_KEY];
      const nextCount = typeof count === 'number' ? count + 1 : 1;
      (globalThis as PlainRecord)[CAPTURED_INIT_COUNT_KEY] = nextCount;
    } catch {
      /* ignore */
    }
  }

  function wrapCheckoutFactory(original: SdkCallable): SdkCallable {
    if (isWrapped(original)) {
      return original;
    }
    const wrapped: SdkCallable = function (this: unknown, ...args: unknown[]): unknown {
      incrementInitCount();
      captureConfig(args[0], 'checkout');
      const result = original.apply(this, args);
      if (result instanceof Promise) {
        void result
          .then((inst: unknown) => {
            tryCaptureFromInstance(inst);
            return inst;
          })
          .catch(() => {});
      }
      return result;
    };
    markWrapped(wrapped);
    copyStatics(original, wrapped);
    return wrapped;
  }

  function wrapComponentConstructor(original: SdkCallable): SdkCallable {
    if (isWrapped(original)) {
      return original;
    }
    const wrapped: SdkCallable = function (this: unknown, ...args: unknown[]): unknown {
      if (args.length > 1) {
        captureConfig(args[1], 'component');
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (new.target === undefined) {
        return original.apply(this, args);
      }
      return Reflect.construct(original, args, original) as unknown;
    };
    markWrapped(wrapped);
    try {
      const orig = original as unknown as { prototype: unknown };
      const wrap = wrapped as unknown as { prototype: unknown };
      wrap.prototype = orig.prototype;
    } catch {
      /* ignore */
    }
    copyStatics(original, wrapped);
    return wrapped;
  }

  let storedAdyenCheckout: unknown;
  try {
    Object.defineProperty(globalThis, 'AdyenCheckout', {
      get() {
        return storedAdyenCheckout;
      },
      set(v: unknown) {
        storedAdyenCheckout =
          typeof v === 'function' && !isWrapped(v) ? wrapCheckoutFactory(v as SdkCallable) : v;
      },
      configurable: true,
      enumerable: true,
    });
  } catch {
    /* ignore */
  }

  let storedAdyenWeb: unknown;
  try {
    Object.defineProperty(globalThis, 'AdyenWeb', {
      get() {
        return storedAdyenWeb;
      },
      set(v: unknown) {
        if (v !== null && typeof v === 'object') {
          const ns = v as PlainRecord;
          for (const key of Object.keys(ns)) {
            const val = ns[key];
            if (typeof val === 'function' && !isWrapped(val)) {
              ns[key] =
                key === 'AdyenCheckout'
                  ? wrapCheckoutFactory(val as SdkCallable)
                  : wrapComponentConstructor(val as SdkCallable);
            }
          }
        }
        storedAdyenWeb = v;
      },
      configurable: true,
      enumerable: true,
    });
  } catch {
    /* ignore */
  }

  (globalThis as PlainRecord)[CAPTURED_CONFIG_KEY + '__ready'] = true;
})();
