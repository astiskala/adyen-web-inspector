/**
 * Page-world extractor — executed via chrome.scripting.executeScript with world: "MAIN".
 * Reads page globals, DOM state, and config in each accessible frame, then
 * serialises a plain result onto a page global for the background scan to read.
 */

import { readAdyenEndpoint } from '../shared/adyen-endpoint.js';
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

/** Page globals from config-interceptor.ts (MAIN world, document_start) and the SDK. */
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
    };
  };
  __k?: unknown;
}

const MAX_TREE_DEPTH = 15;

/**
 * Recursively walks a Preact VNode tree to find `props.core.options`.
 * Returns the options object if found, or null.
 */
function findCoreOptions(node: unknown, depth: number): unknown {
  if (depth > MAX_TREE_DEPTH || typeof node !== 'object' || node === null) return null;

  const vnode = node as PreactVNode;
  const options = vnode.__c?.props?.core?.options;
  if (options !== undefined && options !== null) return options;

  const children = vnode.__k;
  if (!Array.isArray(children)) return findCoreOptions(children, depth + 1);

  for (const child of children) {
    const result = findCoreOptions(child, depth + 1);
    if (result !== null) return result;
  }
  return null;
}

function extractMetadata(g: GlobalWithAdyen): AdyenWebMetadata | null {
  return g.AdyenWebMetadata ?? null;
}

function extractScripts(): ScriptTag[] {
  return [...document.querySelectorAll<HTMLScriptElement>('script[src]')].map((s) => {
    const tag: { src: string; integrity?: string; crossorigin?: string; blockingMode?: string } = {
      src: s.src,
    };
    const integrity = s.getAttribute('integrity');
    const crossorigin = s.getAttribute('crossorigin');
    const blockingMode = s.dataset['blockingmode'];
    if (integrity !== null && integrity !== '') tag.integrity = integrity;
    if (crossorigin !== null && crossorigin !== '') tag.crossorigin = crossorigin;
    if (blockingMode !== undefined && blockingMode !== '') tag.blockingMode = blockingMode;
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
    // Browsers report 0 for opaque cross-origin responses and older Chromium lacks the field.
    const responseStatus =
      typeof resourceEntry.responseStatus === 'number' && resourceEntry.responseStatus > 0
        ? resourceEntry.responseStatus
        : undefined;

    requests.push({
      url: entry.name,
      ...(initiatorType === undefined ? {} : { initiatorType }),
      ...(responseStatus === undefined ? {} : { responseStatus }),
    });
  }

  return requests;
}

interface ComponentExtraction {
  config: CheckoutConfig | null;
  mountCount: number;
}

/**
 * Finds the nearest ancestor element (including the element itself) with `__k`.
 * Walks up to `maxLevels` parent levels.
 */
function findVnodeAncestor(el: Element, maxLevels: number): ElementWithVnode | null {
  let current: Element | null = el;
  for (let i = 0; i <= maxLevels; i++) {
    if (current === null) return null;
    const vnodeEl = current as ElementWithVnode;
    if (vnodeEl.__k !== undefined) return vnodeEl;
    current = current.parentElement;
  }
  return null;
}

/**
 * Finds ALL Preact vnode root mount points on the page, including inside
 * Shadow DOMs. A root is a DOM element with `__k` whose parent does NOT
 * have `__k`.
 */
function findAllVnodeRoots(): ElementWithVnode[] {
  const roots: ElementWithVnode[] = [];
  let scanned = 0;

  function isVnodeRoot(el: Element): boolean {
    const vnodeEl = el as ElementWithVnode;
    if (vnodeEl.__k === undefined) return false;
    const parent = el.parentElement;
    if (parent === null) return true;
    const parentVnodeEl = parent as ElementWithVnode;
    return parentVnodeEl.__k === undefined;
  }

  function walkNode(el: Element): void {
    if (scanned > 10_000 || roots.length >= 20) return;
    scanned++;

    if (isVnodeRoot(el)) {
      roots.push(el);
    }

    if (el.shadowRoot !== null) {
      for (const child of el.shadowRoot.children) {
        walkNode(child);
      }
    }

    for (const child of el.children) {
      walkNode(child);
    }
  }

  walkNode(document.body);
  return roots;
}

/**
 * Finds Adyen checkout elements including inside Shadow DOMs.
 */
function findAdyenElements(): Element[] {
  const results = [...document.querySelectorAll('[class*="adyen-checkout"]')];

  function findShadowHosts(el: Element, depth: number): void {
    if (depth > 6) return;
    if (el.shadowRoot !== null) {
      const adyenInShadow = [...el.shadowRoot.querySelectorAll('[class*="adyen-checkout"]')];
      results.push(...adyenInShadow);
    }
    for (const child of el.children) {
      findShadowHosts(child, depth + 1);
    }
  }

  findShadowHosts(document.body, 0);
  return results;
}

function collectMountPoints(adyenElements: Element[]): Set<ElementWithVnode> {
  const mountPoints = new Set<ElementWithVnode>();

  for (const el of adyenElements) {
    const parentEl = el.parentElement ?? el;
    const ancestor = findVnodeAncestor(parentEl, 10);
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

function processMountPoints(mountPoints: Set<ElementWithVnode>): {
  merged: CheckoutConfig | null;
  findCount: number;
} {
  const configs: CheckoutConfig[] = [];
  let findCount = 0;

  for (const mount of mountPoints) {
    const config = readCheckoutOptions(findCoreOptions(mount.__k, 0), 'checkout');
    if (config !== null) {
      findCount++;
      configs.push(config);
    }
  }

  return { merged: mergeCheckoutConfigs(configs), findCount };
}

function extractComponentConfig(): ComponentExtraction {
  const adyenElements = findAdyenElements();

  const mountPoints = collectMountPoints(adyenElements);

  if (mountPoints.size === 0) {
    return { config: null, mountCount: 0 };
  }

  const { merged, findCount } = processMountPoints(mountPoints);
  // Use findCount (mounts where findCoreOptions found Adyen core options)
  // rather than mountPoints.size, to avoid counting unrelated Preact trees.
  return { config: merged, mountCount: findCount };
}

/**
 * Matches an Adyen API key: starts with "AQ", ~159 chars, contains "==-" and "=-" delimiters.
 */
const ADYEN_API_KEY_PATTERN = /AQ[A-Za-z0-9+/]+==-[A-Za-z0-9+/]+=-[A-Za-z0-9+/]+/;

/** Looks for an Adyen API key in inline scripts and in everything the capture record holds. */
function detectApiKeyExposure(capture: CheckoutCapture): boolean {
  const scripts = document.querySelectorAll<HTMLScriptElement>('script:not([src])');
  for (const script of scripts) {
    if (ADYEN_API_KEY_PATTERN.test(script.textContent)) {
      return true;
    }
  }
  return ADYEN_API_KEY_PATTERN.test(JSON.stringify(capture));
}

/**
 * When Adyen Web is loaded via npm, the SDK's own CSS is bundled into a
 * `<style>` tag or a merchant-hosted CSS file. These sheets contain hundreds
 * of `.adyen-checkout__*` selectors (the SDK's base styles), which should not
 * be counted as merchant overrides. If a single stylesheet exceeds this
 * threshold of Adyen-class selectors, we treat it as the SDK's own CSS bundle.
 */
const SDK_BUNDLE_SELECTOR_THRESHOLD = 50;

/** Safely reads CSS rules from a stylesheet, returning null for cross-origin sheets. */
function safeGetCssRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}

/** Counts --adyen-sdk-* custom properties declared in a single style rule. */
function countAdyenCustomProps(style: CSSStyleDeclaration): number {
  let count = 0;
  for (const prop of style) {
    if (prop.startsWith('--adyen-sdk-')) count++;
  }
  return count;
}

interface StyleAccumulator {
  overrideCount: number;
  overrideSelectors: string[];
  customPropertyCount: number;
}

/** Recursively walks CSS rules including nested @media/@supports/@layer blocks. */
function walkCssRules(rules: CSSRuleList, acc: StyleAccumulator): void {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      if (rule.selectorText.includes('.adyen-checkout__')) {
        acc.overrideCount++;
        if (acc.overrideSelectors.length < 5) {
          acc.overrideSelectors.push(rule.selectorText);
        }
      }
      acc.customPropertyCount += countAdyenCustomProps(rule.style);
    } else if ('cssRules' in rule) {
      walkCssRules((rule as CSSGroupingRule).cssRules, acc);
    }
  }
}

/** Returns true when the stylesheet is likely Adyen's own CSS (Adyen-hosted or npm bundle). */
function isAdyenOwnStylesheet(sheet: CSSStyleSheet, rules: CSSRuleList): boolean {
  if (sheet.href !== null && readAdyenEndpoint(sheet.href) !== null) return true;

  const sheetAcc: StyleAccumulator = {
    overrideCount: 0,
    overrideSelectors: [],
    customPropertyCount: 0,
  };
  walkCssRules(rules, sheetAcc);
  return sheetAcc.overrideCount >= SDK_BUNDLE_SELECTOR_THRESHOLD;
}

/** Scans document stylesheets for Adyen class overrides and custom property usage. */
function extractAdyenStyles(): AdyenStyleInfo {
  const acc: StyleAccumulator = { overrideCount: 0, overrideSelectors: [], customPropertyCount: 0 };

  for (const sheet of document.styleSheets) {
    const rules = safeGetCssRules(sheet);
    if (rules === null) continue;
    if (isAdyenOwnStylesheet(sheet, rules)) continue;

    walkCssRules(rules, acc);
  }

  return {
    classOverrideCount: acc.overrideCount,
    classOverrideSelectors: acc.overrideSelectors,
    customPropertyCount: acc.customPropertyCount,
  };
}

function extract(): PageExtractResult {
  const g = globalThis as GlobalWithAdyen;

  const metadata = extractMetadata(g);
  const { config: componentConfig, mountCount } = extractComponentConfig();
  const capture = readCheckoutCapture(g[PAGE_GLOBALS.checkoutCapture]);
  const apiKeyDetected = detectApiKeyExposure(capture);
  const dom = readCheckoutDom(document);

  return {
    adyenMetadata: metadata,
    capturedConfig: capture.captured,
    inferredConfig: capture.inferred['adyen-request'] ?? null,
    pageJsonConfig: capture.inferred['page-json'] ?? null,
    componentConfig,
    scripts: extractScripts(),
    links: extractLinks(),
    iframes: extractIframes(),
    observedRequests: extractObservedRequests(),
    ...(capture.initCount > 0 ? { checkoutInitCount: capture.initCount } : {}),
    ...(mountCount > 0 ? { componentMountCount: mountCount } : {}),
    ...(dom.dropin ? { hasDropinDOM: true } : {}),
    ...(dom.card ? { hasCardDOM: true } : {}),
    ...(dom.newCardForm ? { hasNewCardFormDOM: true } : {}),
    ...(dom.cardHolderName ? { hasCardHolderNameDOM: true } : {}),
    ...(apiKeyDetected ? { apiKeyDetected: true } : {}),
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
