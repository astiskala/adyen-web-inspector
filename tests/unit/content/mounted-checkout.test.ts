import { beforeEach, describe, expect, it } from 'vitest';
import { readMountedCheckout } from '../../../src/content/mounted-checkout';

interface VnodeElement extends Element {
  __k?: unknown;
}

function openShadowRoot(element: Element): ShadowRoot | null {
  return element.shadowRoot;
}

function readPage(): ReturnType<typeof readMountedCheckout> {
  return readMountedCheckout(document, openShadowRoot);
}

/**
Wraps a vnode in `depth` parent vnodes.
*/
function nestVnode(depth: number, vnode: unknown): unknown {
  let tree = vnode;
  for (let level = 0; level < depth; level += 1) tree = { __k: tree };
  return tree;
}

function coreOptions(options: unknown): unknown {
  return { __c: { props: { core: { options } } } };
}

/**
Mounts markup whose outer element carries a Preact vnode tree, like a mounted Adyen Web root.
*/
function mountTree(markup: string, tree: unknown, parent: ParentNode = document.body): Element {
  const mount = document.createElement('div');
  mount.innerHTML = markup;
  (mount as VnodeElement).__k = tree;
  parent.append(mount);
  return mount;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('readMountedCheckout', () => {
  it('reads Adyen core options from a mounted Preact tree', () => {
    mountTree(
      '<div class="adyen-checkout__dropin"></div>',
      coreOptions({ clientKey: 'test_TREE', locale: 'nl-NL', analytics: { enabled: false } })
    );

    expect(readPage()).toEqual({
      config: { clientKey: 'test_TREE', locale: 'nl-NL', analyticsEnabled: false },
      mountCount: 1,
    });
  });

  it("reads Drop-in's per-method configuration from the props that carry the core", () => {
    mountTree('<div class="adyen-checkout__dropin"></div>', {
      __c: {
        props: {
          core: { options: { showPayButton: true } },
          paymentMethodsConfiguration: { paypal: { showPayButton: false } },
        },
      },
    });

    expect(readPage().config).toMatchObject({
      showPayButton: true,
      hiddenPayButtonMethods: ['paypal'],
    });
  });

  it('counts components created from one AdyenCheckout as one instance', () => {
    const shared = coreOptions({ locale: 'nl-NL' });
    mountTree('<div class="adyen-checkout__card-input"></div>', shared);
    mountTree('<div class="adyen-checkout__ideal"></div>', shared);

    expect(readPage().mountCount).toBe(1);
  });

  it('finds mounts inside shadow roots and merges them, earlier mounts winning', () => {
    mountTree('<div class="adyen-checkout__card-input"></div>', coreOptions({ locale: 'nl-NL' }));
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    mountTree(
      '<div class="adyen-checkout__dropin"></div>',
      coreOptions({ locale: 'fr-FR', countryCode: 'FR' }),
      shadow
    );

    expect(readPage()).toEqual({
      config: { locale: 'nl-NL', countryCode: 'FR' },
      mountCount: 2,
    });
  });

  it('reads through the shadow root lookup it is given, so closed roots can be reached', () => {
    const host = document.createElement('payment-widget');
    document.body.append(host);
    const closed = host.attachShadow({ mode: 'closed' });
    mountTree(
      '<div class="adyen-checkout__dropin"></div>',
      coreOptions({ locale: 'pl-PL' }),
      closed
    );

    expect(readPage().config).toBeNull();
    expect(
      readMountedCheckout(document, (element) => (element === host ? closed : null)).config
    ).toEqual({ locale: 'pl-PL' });
  });

  it.each([
    [
      'nested in a children array',
      { __k: [{ __k: null }, { __k: [coreOptions({ locale: 'a' })] }] },
    ],
    ['under a single child', { __k: coreOptions({ locale: 'a' }) }],
    [
      'after nodes without core options',
      {
        __k: [{ other: true }, { __c: { props: { notCore: true } } }, coreOptions({ locale: 'a' })],
      },
    ],
  ])('walks the vnode tree to options %s', (_label, tree) => {
    mountTree('<div class="adyen-checkout__dropin"></div>', tree);

    expect(readPage().config).toEqual({ locale: 'a' });
  });

  it.each([
    ['without core options', { __k: [{ __c: { props: { something: 'else' } } }, { __k: null }] }],
    ['deeper than the walk limit', nestVnode(16, coreOptions({}))],
    ['whose core options are not an object', coreOptions(42)],
  ])('reports no configuration for a tree %s', (_label, tree) => {
    mountTree('<div class="adyen-checkout__dropin"></div>', tree);

    expect(readPage()).toEqual({ config: null, mountCount: 0 });
  });

  it('ignores Preact roots on pages without Adyen elements', () => {
    mountTree('<div class="app"></div>', coreOptions({ clientKey: 'test_OTHER' }));

    expect(readPage()).toEqual({ config: null, mountCount: 0 });
  });

  it('reads options from a root far above a deeply nested Adyen element', () => {
    const deep = `${'<div>'.repeat(12)}<div class="adyen-checkout__card-input"></div>${'</div>'.repeat(12)}`;
    mountTree(deep, coreOptions({ locale: 'nl-NL' }));

    expect(readPage()).toEqual({ config: { locale: 'nl-NL' }, mountCount: 1 });
  });

  it('stops scanning for vnode roots after twenty', () => {
    document.body.innerHTML = '<div class="adyen-checkout__button"></div>';
    for (let index = 0; index < 25; index += 1) mountTree('<p></p>', coreOptions({ locale: 'a' }));

    expect(readPage().mountCount).toBe(20);
  });

  it('reads an Adyen root mounted directly in a shadow root', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = document.createElement('div');
    root.className = 'adyen-checkout__dropin';
    (root as VnodeElement).__k = coreOptions({ countryCode: 'NL' });
    host.attachShadow({ mode: 'open' }).append(root);

    expect(readPage().config).toEqual({ countryCode: 'NL' });
  });
});
