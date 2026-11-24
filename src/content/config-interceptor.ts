/**
MAIN-world config interceptor — runs at document_start on matching pages,
before the on-demand scan. It captures selected browser-visible checkout
settings through complementary mechanisms:

1. Global AdyenCheckout/AdyenWeb property traps wrap exposed factories and
   component constructors; promise results can expose instance options.
2. Wrapped page fetch and XMLHttpRequest.open calls inspect Adyen request
   URLs for environment, locale, countryCode, and clientKey signals. Fetch
   also reads string bodies sent to Adyen checkout analytics hosts, keeping
   only their SDK fields and component events; no other request body is
   read, and no additional network requests are initiated.
3. Wrapped JSON.parse inspects parsed objects for config-shaped fields.

Everything observed goes into one capture record (shared/checkout-capture.ts),
published on a page global for the on-demand page extractor to read.
*/

import { readAdyenEndpoint } from '../shared/adyen-endpoint.js';
import {
  EMPTY_CHECKOUT_CAPTURE,
  readRequestInference,
  recordAnalytics,
  recordCheckoutInit,
  recordCheckoutOptions,
  recordInference,
} from '../shared/checkout-capture.js';
import { readCheckoutOptions } from '../shared/checkout-config-schema.js';
import { readObservedRequest } from '../shared/observed-requests.js';
import { PAGE_GLOBALS, type PageGlobalValues } from '../shared/constants.js';
import type { CallbackSource, CheckoutCapture } from '../shared/types.js';

(function configInterceptor(): void {
  type PlainRecord = Record<string, unknown>;

  type Callable = (this: unknown, ...arguments_: unknown[]) => unknown;

  const pageGlobals = globalThis as typeof globalThis & PageGlobalValues;

  if (pageGlobals[PAGE_GLOBALS.interceptorInstalled] === true) {
    return;
  }
  pageGlobals[PAGE_GLOBALS.interceptorInstalled] = true;

  /**
  Runs an observation; nothing the interceptor observes may break the page.
  */
  function attempt(observe: () => void): void {
    try {
      observe();
    } catch {
      /*
      ignore
      */
    }
  }

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
    pageGlobals[PAGE_GLOBALS.checkoutCapture] = structuredClone(capture);
  }

  function captureConfig(raw: unknown, source: CallbackSource): void {
    commit(recordCheckoutOptions(capture, raw, source));
  }

  // ---------------------------------------------------------------------------
  // Call observation
  // ---------------------------------------------------------------------------

  const wrapped = new WeakSet<object>();

  interface CallObserver {
    /**
    Sees the arguments before the original runs.
    */
    readonly before?: (arguments_: unknown[]) => void;
    /**
    Sees what the original returned or constructed.
    */
    readonly after?: (result: unknown) => void;
  }

  /**
  Wraps a page function in a Proxy, so calls and `new` reach the original
  unchanged: statics (including inherited ones), prototype, subclassing,
  `instanceof`, name, and length all stay the original's.
  */
  function observeCalls<T extends object>(original: T, { before, after }: CallObserver): T {
    function run(arguments_: unknown[], call: () => unknown): unknown {
      if (before !== undefined) {
        attempt(() => {
          before(arguments_);
        });
      }
      const result = call();
      if (after !== undefined) {
        attempt(() => {
          after(result);
        });
      }
      return result;
    }
    const proxy = new Proxy(original, {
      apply: (target, thisArgument, arguments_: unknown[]): unknown =>
        run(arguments_, () => Reflect.apply(target as Callable, thisArgument, arguments_)),
      construct: (target, arguments_: unknown[], newTarget): object =>
        run(arguments_, () =>
          Reflect.construct(target as Callable, arguments_, newTarget)
        ) as object,
    });
    wrapped.add(proxy);
    return proxy;
  }

  // ---------------------------------------------------------------------------
  // Discovery via Network & JSON
  // ---------------------------------------------------------------------------

  function captureFromUrl(url: string): void {
    commit(
      recordInference(capture, 'adyen-request', readRequestInference(url, globalThis.location.href))
    );
  }

  const originalParse = JSON.parse;
  JSON.parse = observeCalls(originalParse, {
    after: (result) => {
      commit(recordInference(capture, 'page-json', readCheckoutOptions(result, 'checkout')));
    },
  });

  /**
  Request bodies stream, so only string bodies passed in `init` are read.
  */
  function captureAnalytics(url: string, body: unknown): void {
    if (typeof body !== 'string' || readAdyenEndpoint(url)?.role !== 'analytics') return;
    commit(recordAnalytics(capture, originalParse.call(JSON, body) as unknown));
  }

  function requestUrl(input: unknown): string | null {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input instanceof Request ? input.url : null;
  }

  Object.defineProperty(globalThis, 'fetch', {
    value: observeCalls(globalThis.fetch, {
      before: ([input, init]) => {
        const url = requestUrl(input);
        if (url === null) return;
        captureFromUrl(url);
        captureAnalytics(url, (init as RequestInit | undefined)?.body);
      },
    }),
  });

  XMLHttpRequest.prototype.open = observeCalls(XMLHttpRequest.prototype.open, {
    before: ([, input]) => {
      const url = requestUrl(input);
      if (url !== null) captureFromUrl(url);
    },
  });

  // ---------------------------------------------------------------------------
  // Global Property Traps (UMD/ESM)
  // ---------------------------------------------------------------------------

  const seenInstances = new WeakSet<object>();

  /**
  Captures a checkout instance's options once and wraps its create, which
  v5 and earlier use to make components. Instances without create are left alone.
  */
  function captureInstance(instance: unknown): void {
    if (instance === null || typeof instance !== 'object' || seenInstances.has(instance)) return;
    const record = instance as PlainRecord;
    const { create } = record;
    const options = record['options'] ?? record['_options'];
    if (typeof create !== 'function' || options === null || typeof options !== 'object') return;

    seenInstances.add(instance);
    captureConfig(options, 'checkout');
    record['create'] = observeCalls(create, {
      before: (arguments_) => {
        captureConfig(arguments_[1], 'component');
      },
    });
  }

  function wrapCheckoutFactory(original: Callable): Callable {
    return observeCalls(original, {
      before: (arguments_) => {
        commit(recordCheckoutInit(capture));
        captureConfig(arguments_[0], 'checkout');
      },
      after: (result) => {
        if (result instanceof Promise) {
          void result.then(captureInstance).catch(() => {});
        } else {
          captureInstance(result);
        }
      },
    });
  }

  /**
  Which argument of an AdyenWeb namespace function carries component options:
  `createComponent(type, checkout, options)`, else `new Component(checkout, options)`.
  */
  function wrapNamespaceFunction(key: string, original: Callable): Callable {
    if (key === 'AdyenCheckout') return wrapCheckoutFactory(original);
    const optionsIndex = key === 'createComponent' ? 2 : 1;
    return observeCalls(original, {
      before: (arguments_) => {
        captureConfig(arguments_[optionsIndex], 'component');
      },
    });
  }

  function isUnwrappedFunction(value: unknown): value is Callable {
    return typeof value === 'function' && !wrapped.has(value);
  }

  const wrappedNamespaces = new WeakSet<object>();

  function wrapNamespace(namespace: unknown): void {
    if (namespace === null || typeof namespace !== 'object' || wrappedNamespaces.has(namespace)) {
      return;
    }
    wrappedNamespaces.add(namespace);
    const record = namespace as PlainRecord;
    for (const [key, value] of Object.entries(record)) {
      if (isUnwrappedFunction(value)) {
        // Module namespace objects are read-only; their functions stay unwrapped.
        attempt(() => {
          record[key] = wrapNamespaceFunction(key, value);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Resource Timing
  // ---------------------------------------------------------------------------

  // The browser's Resource Timing buffer holds 250 entries by default, and an
  // observer still sees entries once it is full; only checkout requests are kept.
  const OBSERVED_RESOURCE_LIMIT = 500;
  const observedResources: PerformanceEntry[] = [];
  pageGlobals[PAGE_GLOBALS.observedResources] = observedResources;
  attempt(() => {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (observedResources.length >= OBSERVED_RESOURCE_LIMIT) return;
        if (readObservedRequest(entry) !== null) observedResources.push(entry);
      }
    }).observe({ type: 'resource', buffered: true });
  });

  // ---------------------------------------------------------------------------
  // Closed shadow roots
  // ---------------------------------------------------------------------------

  // A closed root is unreachable from its host, so it is recorded as the page attaches it.
  const closedShadowRoots = new WeakMap<Element, ShadowRoot>();
  pageGlobals[PAGE_GLOBALS.closedShadowRoots] = closedShadowRoots;
  // A closed root declared in HTML (<template shadowrootmode="closed">) is never
  // attached by script; its custom element reaches it through ElementInternals,
  // whose shadowRoot is read at scan time because the root can arrive later.
  const ELEMENT_INTERNALS_LIMIT = 1000;
  const elementInternals: WeakRef<ElementInternals>[] = [];
  pageGlobals[PAGE_GLOBALS.elementInternals] = elementInternals;
  attempt(() => {
    HTMLElement.prototype.attachInternals = observeCalls(HTMLElement.prototype.attachInternals, {
      after: (internals) => {
        if (
          internals instanceof ElementInternals &&
          elementInternals.length < ELEMENT_INTERNALS_LIMIT
        ) {
          elementInternals.push(new WeakRef(internals));
        }
      },
    });
  });
  attempt(() => {
    Element.prototype.attachShadow = observeCalls(Element.prototype.attachShadow, {
      after: (root) => {
        if (root instanceof ShadowRoot && root.mode === 'closed') {
          closedShadowRoots.set(root.host, root);
        }
      },
    });
  });

  // ---------------------------------------------------------------------------
  // SDK globals (UMD/CDN builds)
  // ---------------------------------------------------------------------------

  function wrapCheckoutGlobal(value: unknown): unknown {
    return isUnwrappedFunction(value) ? wrapCheckoutFactory(value) : value;
  }

  function wrapNamespaceGlobal(value: unknown): unknown {
    wrapNamespace(value);
    return value;
  }

  /**
  Traps assignment to an SDK global, so a factory is wrapped the moment a
  script defines it, even when the same script calls it straight away, as in
  a bundle that concatenates the SDK with the merchant's code.
  */
  function trapGlobal(name: string, wrap: (value: unknown) => unknown): void {
    attempt(() => {
      // A frame can define the SDK before the interceptor runs; the trap keeps that value.
      let stored = wrap(Reflect.get(globalThis, name));
      Object.defineProperty(globalThis, name, {
        get: () => stored,
        set: (value: unknown) => {
          stored = wrap(value);
        },
        configurable: true,
        enumerable: true,
      });
    });
  }

  /**
  Wraps SDK globals that bypassed the traps: a top-level function or var
  declaration, or Object.defineProperty, replaces a trap or keeps it from
  being installed. A global the page made read-only stays unwrapped.
  */
  function wrapSdkGlobals(): void {
    attempt(() => {
      const checkout: unknown = Reflect.get(globalThis, 'AdyenCheckout');
      if (isUnwrappedFunction(checkout)) {
        Reflect.set(globalThis, 'AdyenCheckout', wrapCheckoutGlobal(checkout));
      }
    });
    attempt(() => {
      wrapNamespace(Reflect.get(globalThis, 'AdyenWeb'));
    });
  }

  // ---------------------------------------------------------------------------
  // AMD loaders (RequireJS on Magento)
  // ---------------------------------------------------------------------------

  /**
  Self-hosted copies keep the SDK's file name, such as Adyen_Payment/js/adyen.js on Magento.
  */
  const ADYEN_SCRIPT_FILE = /\/adyen(?:\.min)?\.js(?:[?#]|$)/;

  function isAdyenNamespace(value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as PlainRecord)['AdyenCheckout'] === 'function'
    );
  }

  /**
  An Adyen Web module, as the UMD build defines it under AMD: v6 fills an
  exports namespace, v5 returns its AdyenCheckout factory.
  */
  function wrapAmdModule(value: unknown, isFromAdyenScript: boolean): unknown {
    if (isAdyenNamespace(value)) return wrapNamespaceGlobal(value);
    const isCheckoutFactory =
      typeof value === 'function' && (isFromAdyenScript || value.name === 'AdyenCheckout');
    return isCheckoutFactory ? wrapCheckoutGlobal(value) : value;
  }

  function wrapAmdFactory(factory: Callable, isFromAdyenScript: boolean): Callable {
    return function (this: unknown, ...dependencies: unknown[]): unknown {
      const result: unknown = Reflect.apply(factory, this, dependencies);
      attempt(() => {
        for (const dependency of dependencies) {
          if (isAdyenNamespace(dependency)) wrapNamespace(dependency);
        }
      });
      let module = result;
      attempt(() => {
        module = wrapAmdModule(result, isFromAdyenScript);
      });
      return module;
    };
  }

  /**
  Replaces a define() call's factory with one that wraps the Adyen module it
  builds. A factory with parameters and no dependency list is left alone,
  because RequireJS reads its source for require() calls.
  */
  function wrapDefineArguments(parameters: unknown[]): unknown[] {
    const factory = parameters.at(-1);
    if (typeof factory !== 'function') return parameters;
    if (parameters.every((parameter) => !Array.isArray(parameter)) && factory.length > 0) {
      return parameters;
    }
    const script = globalThis.document.currentScript;
    const isFromAdyenScript =
      script instanceof HTMLScriptElement && ADYEN_SCRIPT_FILE.test(script.src);
    return [...parameters.slice(0, -1), wrapAmdFactory(factory as Callable, isFromAdyenScript)];
  }

  function wrapDefine(define: unknown): unknown {
    if (!isUnwrappedFunction(define)) return define;
    const proxy = new Proxy(define, {
      apply(target, thisArgument, parameters: unknown[]): unknown {
        let wrappedParameters = parameters;
        attempt(() => {
          wrappedParameters = wrapDefineArguments(parameters);
        });
        return Reflect.apply(target, thisArgument, wrappedParameters);
      },
    });
    wrapped.add(proxy);
    return proxy;
  }

  trapGlobal('AdyenCheckout', wrapCheckoutGlobal);
  trapGlobal('AdyenWeb', wrapNamespaceGlobal);
  trapGlobal('define', wrapDefine);
  // A script's load event fires right after it runs and, in the capture phase,
  // before its own onload handlers, so sync, async, deferred, and lazily
  // inserted SDK scripts are wrapped before merchant code can call them.
  document.addEventListener('load', wrapSdkGlobals, { capture: true });
  // The parser runs microtasks before each script it inserts, so mutation
  // callbacks also wrap an SDK defined by an earlier inline script.
  const parserObserver = new MutationObserver(wrapSdkGlobals);
  parserObserver.observe(document, { childList: true, subtree: true });
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      parserObserver.disconnect();
      wrapSdkGlobals();
    },
    { once: true }
  );
})();
