/**
Page-world extractor — executed via chrome.scripting.executeScript with world: "MAIN".
Reads page globals, DOM state, and config in each accessible frame, then
serialises a plain result onto a page global for the background scan to read.
*/

import { readAdyenEndpoint } from '../shared/adyen-endpoint.js';
import { reportedAnalytics } from '../shared/checkout-analytics.js';
import { readCheckoutCapture } from '../shared/checkout-capture.js';
import { readCheckoutDom } from '../shared/checkout-signals.js';
import { PAGE_GLOBALS, type PageGlobalValues } from '../shared/constants.js';
import { readObservedRequest } from '../shared/observed-requests.js';
import { readShadowRootRecord } from '../shared/shadow-root-record.js';
import { readMountedCheckout } from './mounted-checkout.js';
import type {
  AdyenStyleInfo,
  AdyenWebMetadata,
  CheckoutCapture,
  IframeInfo,
  LinkTag,
  ObservedRequest,
  PageExtractResult,
  ScriptTag,
} from '../shared/types.js';

/**
Page globals from config-interceptor.ts (MAIN world, document_start) and the SDK.
*/
type GlobalWithAdyen = typeof globalThis &
  PageGlobalValues & {
    AdyenWebMetadata?: AdyenWebMetadata;
  };

/**
Keeps only the typed fields of the page's AdyenWebMetadata global, which any page script can set.
*/
function extractMetadata(g: GlobalWithAdyen): AdyenWebMetadata | null {
  const metadata: unknown = g.AdyenWebMetadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const { version, bundleType, variants } = metadata as Record<string, unknown>;
  return {
    ...(typeof version === 'string' && { version }),
    ...(typeof bundleType === 'string' && { bundleType }),
    ...(Array.isArray(variants) && {
      variants: variants.filter((variant): variant is string => typeof variant === 'string'),
    }),
  };
}

function extractScripts(): ScriptTag[] {
  return [...document.querySelectorAll<HTMLScriptElement>('script[src]')].map((s) => {
    const tag: { -readonly [K in keyof ScriptTag]: ScriptTag[K] } = { src: s.src };
    const integrity = s.getAttribute('integrity');
    const crossorigin = s.getAttribute('crossorigin');
    const blockingMode = s.dataset['blockingmode'];
    if (integrity !== null && integrity !== '') tag.integrity = integrity;
    if (crossorigin !== null && crossorigin !== '') tag.crossorigin = crossorigin;
    if (blockingMode !== undefined && blockingMode !== '') tag.blockingMode = blockingMode;
    if (s.nonce !== '') tag.nonce = s.nonce;
    return tag;
  });
}

function extractLinks(): LinkTag[] {
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel][href]')].map((l) => {
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
  return [...document.querySelectorAll<HTMLIFrameElement>('iframe')].map((f) => {
    const info: { name?: string; src?: string; referrerpolicy?: string } = {};
    const name = f.getAttribute('name');
    const source = f.getAttribute('src');
    const rp = f.getAttribute('referrerpolicy');
    if (name !== null && name !== '') info.name = name;
    if (source !== null && source !== '') info.src = source;
    if (rp !== null && rp !== '') info.referrerpolicy = rp;
    return info;
  });
}

/**
Checkout-related Resource Timing entries, from the page's buffer and from
what the config interceptor recorded: Chrome keeps only 250 entries by
default, so on busy pages later checkout requests are missing from the buffer.
*/
function extractObservedRequests(): ObservedRequest[] {
  const recorded = (globalThis as GlobalWithAdyen)[PAGE_GLOBALS.observedResources];
  const entries: unknown[] = [
    ...globalThis.performance.getEntriesByType('resource'),
    ...(Array.isArray(recorded) ? recorded : []),
  ];
  const requests = new Map<string, ObservedRequest>();
  for (const entry of entries) {
    const request = readObservedRequest(entry);
    if (request !== null) {
      requests.set(`${request.url} ${request.initiatorType} ${request.responseStatus}`, request);
    }
  }
  return requests.values().toArray();
}

/**
Matches an Adyen API key: starts with "AQ", ~159 chars, contains "==-" and "=-" delimiters.
The segments are bounded: unbounded ones made every "AQ" in a large inline
base64 blob scan to its end, freezing the merchant page for seconds.
*/
const ADYEN_API_KEY_PATTERN = /AQ[A-Za-z0-9+/]{8,512}==-[A-Za-z0-9+/]{8,256}=-[A-Za-z0-9+/]/;

/**
Looks for an Adyen API key in inline scripts and in everything the capture record holds.
*/
function isApiKeyExposed(capture: CheckoutCapture): boolean {
  const scripts = document.querySelectorAll<HTMLScriptElement>('script:not([src])');
  for (const script of scripts) {
    if (ADYEN_API_KEY_PATTERN.test(script.textContent)) {
      return true;
    }
  }
  return ADYEN_API_KEY_PATTERN.test(JSON.stringify(capture));
}

/**
When Adyen Web is loaded via npm, the SDK's own CSS is bundled into a
`<style>` tag or a merchant-hosted CSS file. These sheets contain hundreds
of `.adyen-checkout__*` selectors (the SDK's base styles), which should not
be counted as merchant overrides. If a single stylesheet exceeds this
threshold of Adyen-class selectors, we treat it as the SDK's own CSS bundle.
*/
const SDK_BUNDLE_SELECTOR_THRESHOLD = 50;

/**
Safely reads CSS rules from a stylesheet, returning null for cross-origin sheets.
*/
function safeGetCssRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}

/**
Counts --adyen-sdk-* custom properties declared in a single style rule.
*/
function countAdyenCustomProperties(style: CSSStyleDeclaration): number {
  let count = 0;
  for (const property of style) {
    if (property.startsWith('--adyen-sdk-')) count++;
  }
  return count;
}

interface StyleAccumulator {
  overrideCount: number;
  overrideSelectors: string[];
  customPropertyCount: number;
}

/**
Recursively walks CSS rules including nested @media/@supports/@layer blocks.
*/
function walkCssRules(rules: CSSRuleList, accumulator: StyleAccumulator): void {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      if (rule.selectorText.includes('.adyen-checkout__')) {
        accumulator.overrideCount++;
        if (accumulator.overrideSelectors.length < 5) {
          accumulator.overrideSelectors.push(rule.selectorText);
        }
      }
      accumulator.customPropertyCount += countAdyenCustomProperties(rule.style);
    } else if ('cssRules' in rule) {
      walkCssRules((rule as CSSGroupingRule).cssRules, accumulator);
    }
  }
}

/**
Returns true when the stylesheet is likely Adyen's own CSS (Adyen-hosted or npm bundle).
*/
function isAdyenOwnStylesheet(sheet: CSSStyleSheet, rules: CSSRuleList): boolean {
  if (sheet.href !== null && readAdyenEndpoint(sheet.href) !== null) return true;

  const sheetAccumulator: StyleAccumulator = {
    overrideCount: 0,
    overrideSelectors: [],
    customPropertyCount: 0,
  };
  walkCssRules(rules, sheetAccumulator);
  return sheetAccumulator.overrideCount >= SDK_BUNDLE_SELECTOR_THRESHOLD;
}

/**
Scans document stylesheets for Adyen class overrides and custom property usage.
*/
function extractAdyenStyles(): AdyenStyleInfo {
  const accumulator: StyleAccumulator = {
    overrideCount: 0,
    overrideSelectors: [],
    customPropertyCount: 0,
  };

  for (const sheet of document.styleSheets) {
    const rules = safeGetCssRules(sheet);
    if (rules === null || isAdyenOwnStylesheet(sheet, rules)) continue;

    walkCssRules(rules, accumulator);
  }

  return {
    classOverrideCount: accumulator.overrideCount,
    classOverrideSelectors: accumulator.overrideSelectors,
    customPropertyCount: accumulator.customPropertyCount,
  };
}

function extract(): PageExtractResult {
  const g = globalThis as GlobalWithAdyen;

  const metadata = extractMetadata(g);
  const shadowRootOf = readShadowRootRecord(g[PAGE_GLOBALS.shadowRoots]);
  const { config: componentConfig, mountCount } = readMountedCheckout(document, shadowRootOf);
  const capture = readCheckoutCapture(g[PAGE_GLOBALS.checkoutCapture]);
  const isApiKeyDetected = isApiKeyExposed(capture);
  const dom = readCheckoutDom(document, shadowRootOf);
  const analytics = reportedAnalytics(capture.analytics);

  return {
    adyenMetadata: metadata,
    observedConfig: {
      captured: capture.captured,
      component: componentConfig,
      inferred: capture.inferred,
    },
    scripts: extractScripts(),
    links: extractLinks(),
    iframes: extractIframes(),
    observedRequests: extractObservedRequests(),
    ...(capture.initCount > 0 && { checkoutInitCount: capture.initCount }),
    ...(mountCount > 0 && { componentMountCount: mountCount }),
    ...(analytics !== undefined && { analytics }),
    ...(dom.dropin && { hasDropinDOM: true }),
    ...(dom.card && { hasCardDOM: true }),
    ...(dom.newCardForm && { hasNewCardFormDOM: true }),
    ...(dom.cardHolderName && { hasCardHolderNameDOM: true }),
    ...(isApiKeyDetected && { apiKeyDetected: true }),
    adyenStyles: extractAdyenStyles(),
    isInsideIframe: globalThis.self !== globalThis.top,
    pageUrl: globalThis.location.href,
    pageProtocol: globalThis.location.protocol,
  };
}

/**
Built-in prototypes that libraries such as Prototype.js give a toJSON method,
which would make JSON.stringify write arrays and strings as other values.
*/
const PATCHED_PROTOTYPES: readonly object[] = [
  Array.prototype,
  String.prototype,
  Number.prototype,
  Boolean.prototype,
  Object.prototype,
];

/**
Serialises the result as plain JSON, setting aside any toJSON the page added to built-in prototypes.
*/
function stringifyPlain(value: unknown): string {
  const patched = PATCHED_PROTOTYPES.map((prototype) => ({
    prototype,
    descriptor: Object.getOwnPropertyDescriptor(prototype, 'toJSON'),
  })).filter(
    (entry): entry is { prototype: object; descriptor: PropertyDescriptor } =>
      entry.descriptor?.configurable === true
  );
  for (const { prototype } of patched) Reflect.deleteProperty(prototype, 'toJSON');
  try {
    return JSON.stringify(value);
  } finally {
    for (const { prototype, descriptor } of patched) {
      Object.defineProperty(prototype, 'toJSON', descriptor);
    }
  }
}

// This function is injected by executeScript and must be self-contained.
const pageExtractResult = extract();
(globalThis as GlobalWithAdyen)[PAGE_GLOBALS.pageExtractResultJson] =
  stringifyPlain(pageExtractResult);
