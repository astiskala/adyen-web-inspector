/**
Page-world extractor — executed via chrome.scripting.executeScript with world: "MAIN".
Reads page globals, DOM state, and config in each accessible frame, then
serialises a plain result onto a page global for the background scan to read.
*/

import { readAdyenEndpoint } from '../shared/adyen-endpoint.js';
import { reportedAnalytics } from '../shared/checkout-analytics.js';
import { readCheckoutCapture } from '../shared/checkout-capture.js';
import { readCheckoutDom } from '../shared/checkout-signals.js';
import { mergeCheckoutConfigs, readCheckoutOptions } from '../shared/checkout-config-schema.js';
import { PAGE_GLOBALS, type PageGlobalValues } from '../shared/constants.js';
import type {
  AdyenStyleInfo,
  AdyenWebMetadata,
  CheckoutCapture,
  CheckoutConfig,
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

interface ElementWithVnode extends Element {
  __k?: unknown;
}

interface PreactVNode {
  __c?: {
    props?: {
      core?: {
        options?: unknown;
      };
      /**
      Drop-in passes its own props, including per-method configuration, beside the core.
      */
      paymentMethodsConfiguration?: unknown;
    };
  };
  __k?: unknown;
}

/**
A mounted checkout: AdyenCheckout options and the per-method configuration beside them.
*/
interface MountedCheckout {
  readonly options: unknown;
  readonly paymentMethodsConfiguration: unknown;
}

const MAX_TREE_DEPTH = 15;

/**
Recursively walks a Preact VNode tree to find the props that carry
`core.options`. Returns the mounted checkout if found, or null.
*/
function findMountedCheckout(root: unknown, rootDepth: number): MountedCheckout | null {
  let node = root;
  let depth = rootDepth;
  while (typeof node === 'object' && node !== null && depth <= MAX_TREE_DEPTH) {
    const vnode = node as PreactVNode;
    const properties = vnode.__c?.props ?? {};
    const options = properties.core?.options;
    if (options !== undefined && options !== null) {
      return { options, paymentMethodsConfiguration: properties.paymentMethodsConfiguration };
    }

    const children = vnode.__k;
    if (Array.isArray(children)) {
      for (const child of children) {
        const result = findMountedCheckout(child, depth + 1);
        if (result !== null) return result;
      }
      return null;
    }
    node = children;
    depth += 1;
  }
  return null;
}

function readMountedConfig(mounted: MountedCheckout): CheckoutConfig | null {
  const config = readCheckoutOptions(mounted.options, 'checkout');
  if (config === null) return null;
  const { paymentMethodsConfiguration } = mounted;
  return { ...config, ...readCheckoutOptions({ paymentMethodsConfiguration }, 'component') };
}

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
    // Browsers report 0 for opaque cross-origin responses and older Chromium lacks the field.
    const responseStatus =
      typeof resourceEntry.responseStatus === 'number' && resourceEntry.responseStatus > 0
        ? resourceEntry.responseStatus
        : undefined;

    requests.push({
      url: entry.name,
      ...(initiatorType !== undefined && { initiatorType }),
      ...(responseStatus !== undefined && { responseStatus }),
    });
  }

  return requests;
}

interface ComponentExtraction {
  config: CheckoutConfig | null;
  mountCount: number;
}

/**
Finds the nearest ancestor element (including the element itself) with `__k`.
Walks up to `maxLevels` parent levels.
*/
function findVnodeAncestor(element: Element, maxLevels: number): ElementWithVnode | null {
  let current: Element | null = element;
  for (let index = 0; index <= maxLevels; index++) {
    if (current === null) return null;
    const vnodeElement = current as ElementWithVnode;
    if (vnodeElement.__k !== undefined) return vnodeElement;
    current = current.parentElement;
  }
  return null;
}

/**
Finds ALL Preact vnode root mount points on the page, including inside
Shadow DOMs. A root is a DOM element with `__k` whose parent does NOT
have `__k`.
*/
function findAllVnodeRoots(): ElementWithVnode[] {
  const roots: ElementWithVnode[] = [];
  let scanned = 0;

  function isVnodeRoot(element: Element): boolean {
    const vnodeElement = element as ElementWithVnode;
    if (vnodeElement.__k === undefined) return false;
    const parent = element.parentElement;
    if (parent === null) return true;
    const parentVnodeElement = parent as ElementWithVnode;
    return parentVnodeElement.__k === undefined;
  }

  function walkNode(element: Element): void {
    if (scanned > 10_000 || roots.length >= 20) return;
    scanned++;

    if (isVnodeRoot(element)) {
      roots.push(element);
    }

    if (element.shadowRoot !== null) {
      for (const child of element.shadowRoot.children) {
        walkNode(child);
      }
    }

    for (const child of element.children) {
      walkNode(child);
    }
  }

  walkNode(document.body);
  return roots;
}

/**
Finds Adyen checkout elements including inside Shadow DOMs.
*/
function findAdyenElements(): Element[] {
  const results = [...document.querySelectorAll('[class*="adyen-checkout"]')];

  function findShadowHosts(element: Element, depth: number): void {
    if (depth > 6) return;
    if (element.shadowRoot !== null) {
      const adyenInShadow = [...element.shadowRoot.querySelectorAll('[class*="adyen-checkout"]')];
      results.push(...adyenInShadow);
    }
    for (const child of element.children) {
      findShadowHosts(child, depth + 1);
    }
  }

  findShadowHosts(document.body, 0);
  return results;
}

function collectMountPoints(adyenElements: Element[]): Set<ElementWithVnode> {
  const mountPoints = new Set<ElementWithVnode>();

  for (const element of adyenElements) {
    const parentElement = element.parentElement ?? element;
    const ancestor = findVnodeAncestor(parentElement, 10);
    if (ancestor !== null) {
      mountPoints.add(ancestor);
    }
  }

  // Only scan for additional vnode roots when Adyen elements are present on
  // the page. This avoids counting unrelated Preact apps as Adyen mounts.
  if (adyenElements.length > 0) {
    const allRoots = findAllVnodeRoots();
    for (const root of allRoots) {
      mountPoints.add(root);
    }
  }

  return mountPoints;
}

/**
Components created from one AdyenCheckout share its options object, so
distinct options objects count checkout instances, not mounted components.
*/
function processMountPoints(mountPoints: Set<ElementWithVnode>): {
  merged: CheckoutConfig | null;
  instanceCount: number;
} {
  const configs: CheckoutConfig[] = [];
  const instances = new Set<unknown>();

  for (const mount of mountPoints) {
    const mounted = findMountedCheckout(mount.__k, 0);
    const config = mounted === null ? null : readMountedConfig(mounted);
    if (mounted === null || config === null) {
      continue;
    }

    instances.add(mounted.options);
    configs.push(config);
  }

  return { merged: mergeCheckoutConfigs(configs), instanceCount: instances.size };
}

function extractComponentConfig(): ComponentExtraction {
  const adyenElements = findAdyenElements();

  const mountPoints = collectMountPoints(adyenElements);

  if (mountPoints.size === 0) {
    return { config: null, mountCount: 0 };
  }

  const { merged, instanceCount } = processMountPoints(mountPoints);
  // Count checkout instances whose options a mounted tree exposed, rather than
  // mountPoints.size, to avoid counting unrelated Preact trees.
  return { config: merged, mountCount: instanceCount };
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
  const { config: componentConfig, mountCount } = extractComponentConfig();
  const capture = readCheckoutCapture(g[PAGE_GLOBALS.checkoutCapture]);
  const isApiKeyDetected = isApiKeyExposed(capture);
  const dom = readCheckoutDom(document);
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

// This function is injected by executeScript and must be self-contained.
const pageExtractResult = extract();
(globalThis as GlobalWithAdyen)[PAGE_GLOBALS.pageExtractResultJson] =
  JSON.stringify(pageExtractResult);
