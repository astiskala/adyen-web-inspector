/**
Shadow-root record — how the config interceptor keeps the closed shadow
roots a page could mount checkout in, for the page extractor: closed roots
the page attaches, recorded as it attaches them, and custom elements'
internals, whose shadowRoot is the only reach into a closed root declared
in HTML and is read at scan time because the root can arrive later. The
page extractor reads the published record back through
`readShadowRootRecord()`.

Content scripts bundle this module inline, so it depends on nothing.
*/

/**
At most this many internals are kept, so pages creating many custom elements stay cheap.
*/
const ELEMENT_INTERNALS_LIMIT = 1000;

/**
The closed shadow roots one frame's config interceptor can reach.
*/
export interface ShadowRootRecord {
  /**
  Closed roots by host, recorded as the page attaches them.
  */
  readonly attached: WeakMap<Element, ShadowRoot>;
  readonly internals: WeakRef<ElementInternals>[];
}

/**
Returns an empty record.
*/
export function createShadowRootRecord(): ShadowRootRecord {
  return { attached: new WeakMap(), internals: [] };
}

/**
Records a shadow root the page attached. Open roots stay reachable from their host, so only closed ones are kept.
*/
export function recordAttachedShadowRoot(record: ShadowRootRecord, root: unknown): void {
  if (root instanceof ShadowRoot && root.mode === 'closed') record.attached.set(root.host, root);
}

/**
Records a custom element's internals, up to the limit.
*/
export function recordElementInternals(record: ShadowRootRecord, internals: unknown): void {
  if (internals instanceof ElementInternals && record.internals.length < ELEMENT_INTERNALS_LIMIT) {
    record.internals.push(new WeakRef(internals));
  }
}

function readDeclaredShadowRoots(internals: unknown): Map<Element, ShadowRoot> {
  const references: unknown[] = Array.isArray(internals) ? internals : [];
  return new Map(
    references.flatMap((reference) => {
      const target: unknown = reference instanceof WeakRef ? reference.deref() : undefined;
      const shadowRoot = target instanceof ElementInternals ? target.shadowRoot : null;
      return shadowRoot === null ? [] : [[shadowRoot.host, shadowRoot] as const];
    })
  );
}

function readAttachedShadowRoot(attached: unknown, element: Element): ShadowRoot | undefined {
  const root: unknown = attached instanceof WeakMap ? attached.get(element) : undefined;
  return root instanceof ShadowRoot ? root : undefined;
}

/**
Reads an element's shadow root through a published record: its open root,
else a closed root the page attached, else one declared in HTML that its
custom element reaches through internals. Page scripts can replace the
record or either part, so each is checked.
*/
export function readShadowRootRecord(value: unknown): (element: Element) => ShadowRoot | null {
  const record: Partial<Record<keyof ShadowRootRecord, unknown>> =
    typeof value === 'object' && value !== null ? value : {};
  const { attached } = record;
  const declared = readDeclaredShadowRoots(record.internals);
  return (element) =>
    element.shadowRoot ??
    readAttachedShadowRoot(attached, element) ??
    declared.get(element) ??
    null;
}
