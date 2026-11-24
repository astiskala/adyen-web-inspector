/**
Mounted checkout — the second capture path into observed configuration:
checkout options read from the Preact tree Adyen Web mounts, the
`component` source beside the capture record's `captured` options. Runs in
the page world inside the page extractor.
*/

import { findCheckoutElements, type ShadowRootLookup } from '../shared/checkout-signals.js';
import { mergeCheckoutConfigs, readCheckoutOptions } from '../shared/checkout-config-schema.js';
import type { CheckoutConfig } from '../shared/types.js';

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
interface MountedOptions {
  readonly options: unknown;
  readonly paymentMethodsConfiguration: unknown;
}

/**
What the mounted trees show: their merged configuration, earlier mounts
winning per field, and how many checkout instances exposed options.
*/
interface MountedCheckout {
  readonly config: CheckoutConfig | null;
  readonly mountCount: number;
}

const MAX_TREE_DEPTH = 15;

/**
Recursively walks a Preact VNode tree to find the props that carry
`core.options`. Returns the mounted options if found, or null.
*/
function findMountedOptions(root: unknown, rootDepth: number): MountedOptions | null {
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
        const result = findMountedOptions(child, depth + 1);
        if (result !== null) return result;
      }
      return null;
    }
    node = children;
    depth += 1;
  }
  return null;
}

function readMountedConfig(mounted: MountedOptions): CheckoutConfig | null {
  const config = readCheckoutOptions(mounted.options, 'checkout');
  if (config === null) return null;
  const { paymentMethodsConfiguration } = mounted;
  return { ...config, ...readCheckoutOptions({ paymentMethodsConfiguration }, 'component') };
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
function findAllVnodeRoots(body: Element, shadowRootOf: ShadowRootLookup): ElementWithVnode[] {
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

    const shadowRoot = shadowRootOf(element);
    if (shadowRoot !== null) {
      for (const child of shadowRoot.children) {
        walkNode(child);
      }
    }

    for (const child of element.children) {
      walkNode(child);
    }
  }

  walkNode(body);
  return roots;
}

function collectMountPoints(
  document: Document,
  shadowRootOf: ShadowRootLookup
): Set<ElementWithVnode> {
  const adyenElements = findCheckoutElements(document, shadowRootOf);
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
    const allRoots = findAllVnodeRoots(document.body, shadowRootOf);
    for (const root of allRoots) {
      mountPoints.add(root);
    }
  }

  return mountPoints;
}

/**
Reads the checkout configuration Adyen Web's mounted Preact trees expose.
Components created from one AdyenCheckout share its options object, so
distinct options objects count checkout instances, not mounted components,
and unrelated Preact trees are not counted.
*/
export function readMountedCheckout(
  document: Document,
  shadowRootOf: ShadowRootLookup
): MountedCheckout {
  const configs: CheckoutConfig[] = [];
  const instances = new Set<unknown>();

  for (const mount of collectMountPoints(document, shadowRootOf)) {
    const mounted = findMountedOptions(mount.__k, 0);
    const config = mounted === null ? null : readMountedConfig(mounted);
    if (mounted === null || config === null) {
      continue;
    }

    instances.add(mounted.options);
    configs.push(config);
  }

  return { config: mergeCheckoutConfigs(configs), mountCount: instances.size };
}
