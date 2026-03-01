import type { CheckoutConfig } from './types.js';

const MAX_SOURCE_LENGTH = 1200;

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

function hasPreactComponent(node: unknown): node is PreactVNode {
  return node !== null && typeof node === 'object';
}

function getCoreOptions(vnode: PreactVNode): unknown {
  const options = vnode.__c?.props?.['core']?.['options'];
  if (options !== undefined) {
    return options;
  }
  return null;
}

/**
 * Recursively walks a Preact VNode tree to find `props.core.options`.
 * Returns the options object if found, or null.
 */
export function findCoreOptions(node: unknown, depth: number): unknown {
  if (node === null || node === undefined || depth > 15) return null;

  if (!hasPreactComponent(node)) return null;

  const options = getCoreOptions(node);
  if (options !== null) return options;

  const children: unknown = node.__k;
  if (Array.isArray(children)) {
    for (const child of children) {
      const result = findCoreOptions(child, depth + 1);
      if (result !== null && result !== undefined) return result;
    }
  } else if (children !== null && children !== undefined && typeof children === 'object') {
    return findCoreOptions(children, depth + 1);
  }

  return null;
}

interface OptionsObject {
  clientKey?: string;
  environment?: string;
  locale?: string;
  countryCode?: string;
  risk?: { enabled?: boolean };
  analytics?: { enabled?: boolean };
  session?: unknown;
  onSubmit?: () => unknown;
  onAdditionalDetails?: () => unknown;
  onPaymentCompleted?: () => unknown;
  onPaymentFailed?: () => unknown;
  onError?: () => unknown;
  beforeSubmit?: () => unknown;
}

/**
 * Extracts CheckoutConfig fields from a core.options object.
 */
export function extractFieldsFromOptions(options: unknown): CheckoutConfig {
  const o = options as OptionsObject;
  const config: Record<string, unknown> = {};

  if (typeof o.clientKey === 'string') config['clientKey'] = o.clientKey;
  if (typeof o.environment === 'string') config['environment'] = o.environment;
  if (typeof o.locale === 'string') config['locale'] = o.locale;
  if (typeof o.countryCode === 'string') config['countryCode'] = o.countryCode;

  if (o.risk !== undefined) {
    config['riskEnabled'] = o.risk.enabled !== false;
  }
  if (o.analytics !== undefined) {
    config['analyticsEnabled'] = o.analytics.enabled !== false;
  }

  if (o.session !== undefined && o.session !== null) {
    config['hasSession'] = true;
  }

  extractCallbacks(o, config);
  extractSources(o, config);

  return config as CheckoutConfig;
}

function extractCallbacks(o: OptionsObject, config: Record<string, unknown>): void {
  const callbackNames = [
    'onSubmit',
    'onAdditionalDetails',
    'onPaymentCompleted',
    'onPaymentFailed',
    'onError',
    'beforeSubmit',
  ] as const;

  for (const name of callbackNames) {
    if (typeof o[name] === 'function') {
      config[name] = 'checkout' as const;
    }
  }
}

function extractSources(o: OptionsObject, config: Record<string, unknown>): void {
  if (typeof o.onSubmit === 'function') {
    try {
      config['onSubmitSource'] = o.onSubmit.toString().substring(0, MAX_SOURCE_LENGTH);
    } catch {
      /* source unavailable */
    }
  }
  if (typeof o.beforeSubmit === 'function') {
    try {
      config['beforeSubmitSource'] = o.beforeSubmit.toString().substring(0, MAX_SOURCE_LENGTH);
    } catch {
      /* source unavailable */
    }
  }
}

/**
 * Merges two CheckoutConfig objects. Base values take precedence;
 * extra fills in undefined gaps.
 */
export function mergeConfigs(base: CheckoutConfig, extra: CheckoutConfig): CheckoutConfig {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && merged[key] === undefined) {
      merged[key] = value;
    }
  }
  return merged as CheckoutConfig;
}
