import { isRecord } from './utils.js';

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
export function findCoreOptions(node: unknown, depth: number): unknown {
  if (depth > MAX_TREE_DEPTH || !isRecord(node)) return null;

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
