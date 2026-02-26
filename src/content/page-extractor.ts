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
  // Common patterns for checkout config exposure
  AdyenCheckout?: {
    _session?: Record<string, unknown>;
    _options?: CheckoutConfig;
    session?: Record<string, unknown>;
    options?: CheckoutConfig;
  };
  _adyenCheckoutConfig?: CheckoutConfig;
  adyenCheckoutConfig?: CheckoutConfig;
};

// Some integrations keep checkout/dropin instances in top-level lexical variables
// (not on window). These declarations let us probe them safely via `typeof`.
declare const checkout:
  | {
      _options?: unknown;
      options?: unknown;
      props?: unknown;
    }
  | undefined;
declare const dropin:
  | {
      _options?: unknown;
      options?: unknown;
      props?: unknown;
    }
  | undefined;

function extractMetadata(g: GlobalWithAdyen): AdyenWebMetadata | null {
  return g.AdyenWebMetadata ?? null;
}

function hasSessionOnInstance(g: GlobalWithAdyen): boolean {
  const session = g.AdyenCheckout?._session ?? g.AdyenCheckout?.session ?? null;
  return session !== null && typeof session === 'object';
}

function extractCheckoutConfig(g: GlobalWithAdyen): CheckoutConfig | null {
  const sessionDetected = hasSessionOnInstance(g);

  // Try known global names merchants commonly use.
  // Also inspect runtime instances (checkout/dropin) when available.
  const candidates = [
    g._adyenCheckoutConfig,
    g.adyenCheckoutConfig,
    g.AdyenCheckout?._options,
    g.AdyenCheckout?.options,
    getRuntimeCheckoutConfigCandidate(),
    getRuntimeDropinConfigCandidate(),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCheckoutConfigCandidate(candidate);
    if (normalized) {
      return sessionDetected ? { ...normalized, hasSession: true } : normalized;
    }
  }

  // Attempt to find by scanning script tag contents (heuristic)
  // We look for AdyenCheckout({ ... }) call and try to extract its argument
  const inlineScripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script:not([src])')
  );
  for (const script of inlineScripts) {
    const scriptText = script.textContent;
    const match = /(?:new\s+|await\s+)?(?:window\.)?AdyenCheckout\s*\((\{[\s\S]*?\})\s*\)/.exec(
      scriptText
    );
    const configSource = match?.[1];
    if (configSource !== undefined && configSource !== '') {
      try {
        // Sanitised eval-free parse: extract simple key/string value pairs
        return parseConfigHeuristic(configSource);
      } catch {
        // Parsing failed — skip
      }
    }
  }

  // Even without config, if the checkout instance has a session, return a minimal config
  if (sessionDetected) {
    return { hasSession: true };
  }

  return null;
}

function getRuntimeCheckoutConfigCandidate(): unknown {
  try {
    if (typeof checkout === 'undefined' || typeof checkout !== 'object') {
      return null;
    }
    return checkout.options ?? checkout.props ?? checkout._options ?? checkout;
  } catch {
    return null;
  }
}

function getRuntimeDropinConfigCandidate(): unknown {
  try {
    if (typeof dropin === 'undefined' || typeof dropin !== 'object') {
      return null;
    }
    return dropin.options ?? dropin.props ?? dropin._options ?? dropin;
  } catch {
    return null;
  }
}

function normalizeMaybeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'function') {
    return true;
  }
  return undefined;
}

function normalizeCheckoutConfigCandidate(candidate: unknown): CheckoutConfig | null {
  if (candidate === null || typeof candidate !== 'object') {
    return null;
  }

  const record = candidate as Record<string, unknown>;

  const clientKey = typeof record['clientKey'] === 'string' ? record['clientKey'] : undefined;
  const environment = typeof record['environment'] === 'string' ? record['environment'] : undefined;
  const locale = typeof record['locale'] === 'string' ? record['locale'] : undefined;
  const countryCode = typeof record['countryCode'] === 'string' ? record['countryCode'] : undefined;
  const riskEnabled = normalizeMaybeBoolean(record['riskEnabled']);
  const analyticsRecord = record['analytics'];
  const analyticsEnabled =
    typeof analyticsRecord === 'object' && analyticsRecord !== null
      ? normalizeMaybeBoolean((analyticsRecord as Record<string, unknown>)['enabled'])
      : undefined;
  const onSubmit = normalizeMaybeBoolean(record['onSubmit']);
  const onAdditionalDetails = normalizeMaybeBoolean(record['onAdditionalDetails']);
  const onPaymentCompleted = normalizeMaybeBoolean(record['onPaymentCompleted']);
  const onPaymentFailed = normalizeMaybeBoolean(record['onPaymentFailed']);
  const onError = normalizeMaybeBoolean(record['onError']);
  const beforeSubmit = normalizeMaybeBoolean(record['beforeSubmit']);

  const normalized: CheckoutConfig = {
    ...(clientKey === undefined ? {} : { clientKey }),
    ...(environment === undefined ? {} : { environment }),
    ...(locale === undefined ? {} : { locale }),
    ...(countryCode === undefined ? {} : { countryCode }),
    ...(riskEnabled === undefined ? {} : { riskEnabled }),
    ...(analyticsEnabled === undefined ? {} : { analyticsEnabled }),
    ...(onSubmit === undefined ? {} : { onSubmit }),
    ...(onAdditionalDetails === undefined ? {} : { onAdditionalDetails }),
    ...(onPaymentCompleted === undefined ? {} : { onPaymentCompleted }),
    ...(onPaymentFailed === undefined ? {} : { onPaymentFailed }),
    ...(onError === undefined ? {} : { onError }),
    ...(beforeSubmit === undefined ? {} : { beforeSubmit }),
  };

  return Object.keys(normalized).length === 0 ? null : normalized;
}

/**
 * Heuristic extraction of simple string/boolean config values from a JS object literal.
 * This deliberately handles only top-level primitive keys to avoid using eval().
 */
function parseConfigHeuristic(source: string): CheckoutConfig {
  const config: Record<string, string | boolean> = {};

  // Match string values: key: "value" or key: 'value'
  const stringPattern = /(\w+)\s*:\s*['"]([^'"]+)['"]/g;
  let m = stringPattern.exec(source);
  while (m) {
    const key = m[1];
    const value = m[2];
    if (key !== undefined && value !== undefined) {
      config[key] = value;
    }
    m = stringPattern.exec(source);
  }

  // Match boolean values: key: true|false
  const boolPattern = /(\w+)\s*:\s*(true|false)\b/g;
  let b = boolPattern.exec(source);
  while (b) {
    const key = b[1];
    const value = b[2];
    if (key !== undefined && value !== undefined) {
      config[key] = value === 'true';
    }
    b = boolPattern.exec(source);
  }

  // Extract analytics.enabled from nested analytics object.
  const analyticsBlockMatch = /\banalytics\s*:\s*\{([\s\S]*?)\}/.exec(source);
  const analyticsBlock = analyticsBlockMatch?.[1];
  if (analyticsBlock !== undefined && analyticsBlock !== '') {
    const analyticsEnabledMatch = /\benabled\s*:\s*(true|false)\b/.exec(analyticsBlock);
    if (analyticsEnabledMatch) {
      config['analyticsEnabled'] = analyticsEnabledMatch[1] === 'true';
    }
  }

  // Detect callback presence by function expression patterns
  const callbackKeys = [
    'onSubmit',
    'onAdditionalDetails',
    'onPaymentCompleted',
    'onPaymentFailed',
    'onError',
    'beforeSubmit',
  ];
  for (const key of callbackKeys) {
    const cbPattern = new RegExp(
      String.raw`${key}\s*:\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>)`
    );
    if (cbPattern.test(source)) {
      config[key] = true;
    }
  }

  // Extract a bounded onSubmit snippet for callback-actions-pattern checks.
  // We keep it heuristic and avoid parsing executable JS.
  const onSubmitIndex = source.indexOf('onSubmit');
  if (onSubmitIndex !== -1) {
    const snippet = source.slice(onSubmitIndex, onSubmitIndex + 1200).trim();
    if (snippet) {
      config['onSubmitSource'] = snippet;
    }
  }

  // Detect session object: session: { id: "...", sessionData: "..." }
  // This indicates the Sessions integration flow.
  if (/\bsession\s*:\s*\{/.test(source)) {
    config['hasSession'] = true;
  }

  return config as unknown as CheckoutConfig;
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
    scripts: extractScripts(),
    links: extractLinks(),
    iframes: extractIframes(),
    observedRequests: extractObservedRequests(),
    isInsideIframe: globalThis.self !== globalThis.top,
    pageUrl: globalThis.location.href,
    pageProtocol: globalThis.location.protocol,
  };
}

// This function is injected by executeScript — it must be self-contained and return a value.
extract();
