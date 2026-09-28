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
  const options = vnode.__c?.props?.core?.options;
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
