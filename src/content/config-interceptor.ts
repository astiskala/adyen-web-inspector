/**
 * MAIN-world config interceptor — runs at document_start on matching pages,
 * before the on-demand scan. It captures selected browser-visible checkout
 * settings through complementary mechanisms:
 *
 * 1. Global AdyenCheckout/AdyenWeb property traps wrap exposed factories and
 *    component constructors; promise results can expose instance options.
 * 2. Wrapped page fetch and XMLHttpRequest.open calls inspect Adyen request
 *    URLs for environment, locale, countryCode, and clientKey signals. Fetch
 *    also reads string bodies sent to Adyen checkout analytics hosts, keeping
 *    only component events; no other request body is read, and no additional
 *    network requests are initiated.
 * 3. Wrapped JSON.parse inspects parsed objects for config-shaped fields.
 *
 * Everything observed goes into one capture record (shared/checkout-capture.ts),
 * published on a page global for the on-demand page extractor to read.
 */

import { readAdyenEndpoint } from '../shared/adyen-endpoint.js';
import {
  EMPTY_CHECKOUT_CAPTURE,
  readRequestInference,
  recordAnalyticsEvents,
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
  type SdkCallable = (this: unknown, ...arguments_: unknown[]) => unknown;

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

  /**
  Keeps and publishes a changed record; recording functions return the same record when nothing changed.
   */
  function commit(next: CheckoutCapture): void {
    if (next === capture) return;
    capture = next;
    try {
      pageGlobals[PAGE_GLOBALS.checkoutCapture] = structuredClone(capture);
    } catch {
      /*
      ignore
      */
    }
  }

  function captureConfig(raw: unknown, source: CallbackSource): void {
    try {
      commit(recordCheckoutOptions(capture, raw, source));
    } catch {
      /*
      ignore
      */
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
      /*
      ignore
      */
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

  /**
  Request bodies stream, so only string bodies passed in `init` are read.
   */
  function tryCaptureAnalytics(url: string, body: unknown): void {
    if (typeof body !== 'string' || readAdyenEndpoint(url)?.role !== 'analytics') return;
    try {
      commit(recordAnalyticsEvents(capture, originalParse.call(JSON, body) as unknown));
    } catch {
      /*
      ignore
      */
    }
  }

  function fetchUrl(input: RequestInfo | URL): string | null {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return input instanceof Request ? input.url : null;
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = fetchUrl(input);
    if (url !== null) {
      tryCaptureFromUrl(url);
      tryCaptureAnalytics(url, init?.body);
    }

    return originalFetch.call(globalThis, input, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...arguments_: unknown[]
  ): void {
    const u = typeof url === 'string' ? url : url.toString();
    tryCaptureFromUrl(u);

    try {
      const openArguments = [method, url, ...arguments_] as [
        string,
        string | URL,
        boolean,
        string?,
        string?,
      ];
      originalOpen.apply(this, openArguments);
      return;
    } catch {
      /*
      ignore
      */
    }
  };

  // ---------------------------------------------------------------------------
  // Global Property Traps (UMD/ESM)
  // ---------------------------------------------------------------------------

  function isWrapped(function_: unknown): boolean {
    return (
      typeof function_ === 'function' && (function_ as unknown as PlainRecord)[WRAPPED] === true
    );
  }

  function markWrapped(function_: SdkCallable): void {
    try {
      (function_ as unknown as PlainRecord)[WRAPPED] = true;
    } catch {
      /*
      ignore
      */
    }
  }

  function copyStatics(original: SdkCallable, wrapped: SdkCallable): void {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(original))) {
      if (['prototype', 'length', 'name', 'arguments', 'caller'].includes(key)) {
        continue;
      }
      try {
        Object.defineProperty(wrapped, key, descriptor);
      } catch {
        /*
        ignore
        */
      }
    }
  }

  /**
  Wraps a checkout instance's create; the instance marker keeps it from being wrapped twice.
   */
  function wrapInstanceCreate(index: PlainRecord, create: SdkCallable): void {
    const wrappedCreate = function (this: unknown, ...cArguments: unknown[]): unknown {
      if (cArguments.length > 1) {
        captureConfig(cArguments[1], 'component');
      }
      return create.apply(this, cArguments);
    };
    markWrapped(wrappedCreate);
    index['create'] = wrappedCreate;
  }

  function tryCaptureFromInstance(inst: unknown): boolean {
    if (inst === null || typeof inst !== 'object') {
      return false;
    }

    const index = inst as PlainRecord;
    // Heuristic: looks like an Adyen Checkout instance
    const create = index['create'];
    const options = index['options'] ?? index['_options'];
    const hasOptions = options !== undefined && options !== null && typeof options === 'object';

    if (typeof create === 'function' && hasOptions) {
      if (index[ADYEN_INSTANCE_MARKER] === true) {
        return true;
      }
      try {
        index[ADYEN_INSTANCE_MARKER] = true;
      } catch {
        /*
        ignore
        */
      }

      captureConfig(options, 'checkout');
      wrapInstanceCreate(index, create as SdkCallable);
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

  /**
  Wraps an AdyenCheckout factory; callers skip factories that are already wrapped.
   */
  function wrapCheckoutFactory(original: SdkCallable): SdkCallable {
    const wrapped: SdkCallable = function (this: unknown, ...arguments_: unknown[]): unknown {
      incrementInitCount();
      captureConfig(arguments_[0], 'checkout');
      const result = original.apply(this, arguments_);
      if (result instanceof Promise) {
        observeCheckoutFactoryResult(result);
      }
      return result;
    };
    markWrapped(wrapped);
    copyStatics(original, wrapped);
    return wrapped;
  }

  /**
  Wraps a component constructor; callers skip constructors that are already wrapped.
   */
  function wrapComponentConstructor(original: SdkCallable): SdkCallable {
    const wrapped: SdkCallable = function (this: unknown, ...arguments_: unknown[]): unknown {
      if (arguments_.length > 1) {
        captureConfig(arguments_[1], 'component');
      }
      const target = new.target as unknown;
      return target === undefined
        ? original.apply(this, arguments_)
        : (Reflect.construct(original, arguments_, original) as unknown);
    };
    markWrapped(wrapped);
    try {
      const orig = original as unknown as { prototype: unknown };
      const wrap = wrapped as unknown as { prototype: unknown };
      wrap.prototype = orig.prototype;
    } catch {
      /*
      ignore
      */
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
    /*
    ignore
    */
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
            const value = ns[key];
            if (typeof value === 'function' && !isWrapped(value)) {
              ns[key] =
                key === 'AdyenCheckout'
                  ? wrapCheckoutFactory(value as SdkCallable)
                  : wrapComponentConstructor(value as SdkCallable);
            }
          }
        }
        storedAdyenWeb = v;
      },
      configurable: true,
      enumerable: true,
    });
  } catch {
    /*
    ignore
    */
  }
})();
