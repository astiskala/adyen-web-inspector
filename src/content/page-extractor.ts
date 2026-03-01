/**
 * Page-world extractor — executed via chrome.scripting.executeScript with world: "MAIN".
 * Runs in the page's JS context to read globals, DOM state, and config.
 * Must return a plain serialisable object (no class instances, no functions).
 */

import {
  findCoreOptions,
  extractFieldsFromOptions,
  mergeConfigs,
} from '../shared/preact-tree-extractor.js';
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

interface ElementWithVnode extends Element {
  __k?: unknown;
}

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
    if (scanned > 10000 || roots.length >= 20) return;
    scanned++;

    if (isVnodeRoot(el)) {
      roots.push(el as ElementWithVnode);
    }

    if (el.shadowRoot !== null) {
      for (const child of Array.from(el.shadowRoot.children)) {
        walkNode(child);
      }
    }

    for (const child of Array.from(el.children)) {
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
  const results = Array.from(document.querySelectorAll('[class*="adyen-checkout"]'));

  function findShadowHosts(el: Element, depth: number): void {
    if (depth > 6) return;
    if (el.shadowRoot !== null) {
      const adyenInShadow = Array.from(el.shadowRoot.querySelectorAll('[class*="adyen-checkout"]'));
      results.push(...adyenInShadow);
    }
    for (const child of Array.from(el.children)) {
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

  const allRoots = findAllVnodeRoots();
  for (const root of allRoots) {
    mountPoints.add(root);
  }

  return mountPoints;
}

function processMountPoints(mountPoints: Set<ElementWithVnode>): {
  merged: CheckoutConfig | null;
  findCount: number;
} {
  let merged: CheckoutConfig | null = null;
  let findCount = 0;

  for (const mount of mountPoints) {
    const vnode: unknown = mount.__k;
    const options = findCoreOptions(vnode, 0);
    if (options !== null && options !== undefined) {
      findCount++;
      const extracted = extractFieldsFromOptions(options);
      merged = merged === null ? extracted : mergeConfigs(merged, extracted);
    }
  }

  return { merged, findCount };
}

function extractComponentConfig(): ComponentExtraction {
  const adyenElements = findAdyenElements();

  const mountPoints = collectMountPoints(adyenElements);

  if (mountPoints.size === 0) {
    return { config: null, mountCount: 0 };
  }

  const { merged } = processMountPoints(mountPoints);
  return { config: merged, mountCount: mountPoints.size };
}

function extract(): PageExtractResult {
  const g = globalThis as GlobalWithAdyen;

  const metadata = extractMetadata(g);
  const { config: componentConfig, mountCount } = extractComponentConfig();
  const checkoutConfig = extractCheckoutConfig(g);
  const inferredConfig = extractInferredConfig(g);

  return {
    adyenMetadata: metadata,
    checkoutConfig,
    inferredConfig,
    componentConfig,
    scripts: extractScripts(),
    links: extractLinks(),
    iframes: extractIframes(),
    observedRequests: extractObservedRequests(),
    ...(typeof g.__adyenWebInspectorCheckoutInitCount === 'number'
      ? { checkoutInitCount: g.__adyenWebInspectorCheckoutInitCount }
      : {}),
    ...(mountCount > 0 ? { componentMountCount: mountCount } : {}),
    isInsideIframe: globalThis.self !== globalThis.top,
    pageUrl: globalThis.location.href,
    pageProtocol: globalThis.location.protocol,
  };
}

// This function is injected by executeScript — it must be self-contained and return a value.
extract();
