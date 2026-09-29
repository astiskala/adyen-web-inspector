/**
 * MAIN-world config interceptor — runs at document_start on matching pages,
 * before the on-demand scan. It captures selected browser-visible checkout
 * settings through complementary mechanisms:
 *
 * 1. Global AdyenCheckout/AdyenWeb property traps wrap exposed factories and
 *    component constructors; promise results can expose instance options.
 * 2. Wrapped page fetch and XMLHttpRequest.open calls inspect Adyen request
 *    URLs for environment, locale, countryCode, and clientKey signals. They do
 *    not read request bodies or initiate additional network requests.
 * 3. Wrapped JSON.parse inspects parsed objects for config-shaped fields.
 *
 * Everything observed goes into one capture record (shared/checkout-capture.ts),
 * published on a page global for the on-demand page extractor to read.
 */

import {
  EMPTY_CHECKOUT_CAPTURE,
  readRequestInference,
  recordCheckoutInit,
  recordCheckoutOptions,
  recordInference,
} from '../shared/checkout-capture.js';
import { readCheckoutOptions } from '../shared/checkout-config-schema.js';
import { PAGE_GLOBALS, type PageGlobalValues } from '../shared/constants.js';
import type { CallbackSource, CheckoutCapture } from '../shared/types.js';

(function configInterceptor(): void {
  const WRAPPED = '__awInspectorWrapped';

  type PlainRecord = Record<string, unknown>;
  type SdkCallable = (this: unknown, ...args: unknown[]) => unknown;

  const ADYEN_INSTANCE_MARKER = '__adyenInstance';
  const pageGlobals = globalThis as typeof globalThis & PageGlobalValues;

  if (pageGlobals[PAGE_GLOBALS.interceptorInstalled] === true) {
    return;
  }
  pageGlobals[PAGE_GLOBALS.interceptorInstalled] = true;

  // ---------------------------------------------------------------------------
  // Capture record
  // ---------------------------------------------------------------------------

  let capture: CheckoutCapture = EMPTY_CHECKOUT_CAPTURE;

  /** Keeps and publishes a changed record; recording functions return the same record when nothing changed. */
  function commit(next: CheckoutCapture): void {
    if (next === capture) return;
    capture = next;
    try {
      pageGlobals[PAGE_GLOBALS.checkoutCapture] = structuredClone(capture);
    } catch {
      /* ignore */
    }
  }

  function captureConfig(raw: unknown, source: CallbackSource): void {
    try {
      commit(recordCheckoutOptions(capture, raw, source));
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------------
  // Discovery via Network & JSON
  // ---------------------------------------------------------------------------

  function tryCaptureFromUrl(url: string): void {
    try {
      const inferred = readRequestInference(url, globalThis.location.href);
      commit(recordInference(capture, 'adyen-request', inferred));
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
      try {
        commit(recordInference(capture, 'page-json', readCheckoutOptions(result, 'checkout')));
      } catch {
        return result;
      }
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
      originalOpen.apply(this, openArgs);
      return;
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
    commit(recordCheckoutInit(capture));
  }

  function observeCheckoutFactoryResult(result: Promise<unknown>): void {
    result
      .then((inst: unknown) => {
        tryCaptureFromInstance(inst);
      })
      .catch(() => {});
  }

  /** Wraps an AdyenCheckout factory; callers skip factories that are already wrapped. */
  function wrapCheckoutFactory(original: SdkCallable): SdkCallable {
    const wrapped: SdkCallable = function (this: unknown, ...args: unknown[]): unknown {
      incrementInitCount();
      captureConfig(args[0], 'checkout');
      const result = original.apply(this, args);
      if (result instanceof Promise) {
        observeCheckoutFactoryResult(result);
      }
      return result;
    };
    markWrapped(wrapped);
    copyStatics(original, wrapped);
    return wrapped;
  }

  /** Wraps a component constructor; callers skip constructors that are already wrapped. */
  function wrapComponentConstructor(original: SdkCallable): SdkCallable {
    const wrapped: SdkCallable = function (this: unknown, ...args: unknown[]): unknown {
      if (args.length > 1) {
        captureConfig(args[1], 'component');
      }
      const target = new.target as unknown;
      if (target !== undefined) {
        return Reflect.construct(original, args, original) as unknown;
      }
      return original.apply(this, args);
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
})();
