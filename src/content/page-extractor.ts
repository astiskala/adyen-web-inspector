/**
 * Page-world extractor — executed via chrome.scripting.executeScript with world: "MAIN".
 * Runs in the page's JS context to read globals, DOM state, and config.
 * Must return a plain serialisable object (no class instances, no functions).
 */

import type {
  AdyenWebMetadata,
  CheckoutConfig,
  IframeInfo,
  LinkTag,
  ObservedRequest,
  PageExtractResult,
  ScriptTag,
} from '../shared/types.js';

type GlobalWithAdyen = typeof globalThis & {
  AdyenWebMetadata?: AdyenWebMetadata;
  /** Published by config-interceptor.ts (MAIN-world, document_start). */
  __adyenWebInspectorCapturedConfig?: CheckoutConfig;
  /** Published by config-interceptor.ts (MAIN-world, document_start). */
  __adyenWebInspectorCapturedInferredConfig?: CheckoutConfig;
  /** Published by config-interceptor.ts (MAIN-world, document_start). */
  __adyenWebInspectorCheckoutInitCount?: number;
};

function extractMetadata(g: GlobalWithAdyen): AdyenWebMetadata | null {
  return g.AdyenWebMetadata ?? null;
}

/**
 * Reads the checkout config published by the MAIN-world config-interceptor.
 * The interceptor captures actual runtime values from AdyenCheckout() and
 * component constructor calls, so no static analysis is needed here.
 */
function extractCheckoutConfig(g: GlobalWithAdyen): CheckoutConfig | null {
  const captured = g.__adyenWebInspectorCapturedConfig;
  if (captured && typeof captured === 'object' && Object.keys(captured).length > 0) {
    return captured;
  }
  return null;
}

function extractInferredConfig(g: GlobalWithAdyen): CheckoutConfig | null {
  const inferred = g.__adyenWebInspectorCapturedInferredConfig;
  if (inferred && typeof inferred === 'object' && Object.keys(inferred).length > 0) {
    return inferred;
  }
  return null;
}

function extractScripts(): ScriptTag[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).map((s) => {
    const tag: { src: string; integrity?: string; crossorigin?: string } = { src: s.src };
    const integrity = s.getAttribute('integrity');
    const crossorigin = s.getAttribute('crossorigin');
    if (integrity !== null && integrity !== '') tag.integrity = integrity;
    if (crossorigin !== null && crossorigin !== '') tag.crossorigin = crossorigin;
    return tag;
  });
}

function extractLinks(): LinkTag[] {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel][href]')).map((l) => {
    const tag: { href: string; rel: string; integrity?: string; crossorigin?: string } = {
      href: l.href,
      rel: l.rel,
    };
    const integrity = l.getAttribute('integrity');
    const crossorigin = l.getAttribute('crossorigin');
    if (integrity !== null && integrity !== '') tag.integrity = integrity;
    if (crossorigin !== null && crossorigin !== '') tag.crossorigin = crossorigin;
    return tag;
  });
}

function extractIframes(): IframeInfo[] {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).map((f) => {
    const info: { name?: string; src?: string; referrerpolicy?: string } = {};
    const name = f.getAttribute('name');
    const src = f.getAttribute('src');
    const rp = f.getAttribute('referrerpolicy');
    if (name !== null && name !== '') info.name = name;
    if (src !== null && src !== '') info.src = src;
    if (rp !== null && rp !== '') info.referrerpolicy = rp;
    return info;
  });
}

function extractObservedRequests(): ObservedRequest[] {
  const entries = globalThis.performance.getEntriesByType('resource');
  const requests: ObservedRequest[] = [];

  for (const entry of entries) {
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      continue;
    }

    const resourceEntry = entry as PerformanceResourceTiming;
    const initiatorType =
      typeof resourceEntry.initiatorType === 'string' && resourceEntry.initiatorType.length > 0
        ? resourceEntry.initiatorType
        : undefined;

    requests.push({
      url: entry.name,
      ...(initiatorType === undefined ? {} : { initiatorType }),
    });
  }

  return requests;
}

function extract(): PageExtractResult {
  const g = globalThis as GlobalWithAdyen;
  return {
    adyenMetadata: extractMetadata(g),
    checkoutConfig: extractCheckoutConfig(g),
    inferredConfig: extractInferredConfig(g),
    scripts: extractScripts(),
    links: extractLinks(),
    iframes: extractIframes(),
    observedRequests: extractObservedRequests(),
    checkoutInitCount: g.__adyenWebInspectorCheckoutInitCount,
    isInsideIframe: globalThis.self !== globalThis.top,
    pageUrl: globalThis.location.href,
    pageProtocol: globalThis.location.protocol,
  };
}

// This function is injected by executeScript — it must be self-contained and return a value.
extract();
