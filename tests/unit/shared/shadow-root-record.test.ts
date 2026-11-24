import { describe, expect, it } from 'vitest';
import {
  createShadowRootRecord,
  readShadowRootRecord,
  recordAttachedShadowRoot,
  recordElementInternals,
} from '../../../src/shared/shadow-root-record';

class InternalsHost extends HTMLElement {
  readonly internals = this.attachInternals();
}
customElements.define('shadow-record-host', InternalsHost);

function closedHost(): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div');
  return { host, root: host.attachShadow({ mode: 'closed' }) };
}

describe('shadow-root record', () => {
  it('reads back the closed roots the page attached, and open roots from their host', () => {
    const record = createShadowRootRecord();
    const closed = closedHost();
    const openHost = document.createElement('div');
    const open = openHost.attachShadow({ mode: 'open' });
    recordAttachedShadowRoot(record, closed.root);
    recordAttachedShadowRoot(record, open);
    recordAttachedShadowRoot(record, 'not a root');

    const shadowRootOf = readShadowRootRecord(record);

    expect(shadowRootOf(closed.host)).toBe(closed.root);
    expect(shadowRootOf(openHost)).toBe(open);
    expect(record.attached.has(openHost)).toBe(false);
    expect(shadowRootOf(document.createElement('div'))).toBeNull();
  });

  it("reaches a closed root through its custom element's internals, read when the record is read", () => {
    const record = createShadowRootRecord();
    const host = new InternalsHost();
    recordElementInternals(record, host.internals);
    recordElementInternals(record, {});
    const root = host.attachShadow({ mode: 'closed' });

    expect(record.internals).toHaveLength(1);
    expect(readShadowRootRecord(record)(host)).toBe(root);
  });

  it('keeps at most a thousand internals', () => {
    const record = createShadowRootRecord();
    const first = new InternalsHost().internals;
    recordElementInternals(record, first);
    for (let index = 0; index < 1000; index += 1) {
      recordElementInternals(record, new InternalsHost().internals);
    }

    expect(record.internals).toHaveLength(1000);
    expect(record.internals[0]?.deref()).toBe(first);
  });

  it.each([
    ['missing', undefined],
    ['replaced by a string', 'tampered'],
    ['with replaced parts', { attached: { get: (): null => null }, internals: { length: 1 } }],
    [
      'with entries that are not what was recorded',
      { attached: new WeakMap([[document.body, 'root']]), internals: [new WeakRef({}), 'x'] },
    ],
  ])('reads only open roots from a record %s', (_label, value) => {
    const { host } = closedHost();
    const openHost = document.createElement('div');
    const open = openHost.attachShadow({ mode: 'open' });

    const shadowRootOf = readShadowRootRecord(value);

    expect(shadowRootOf(host)).toBeNull();
    expect(shadowRootOf(document.body)).toBeNull();
    expect(shadowRootOf(openHost)).toBe(open);
  });
});
