import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_GLOBALS } from '../../../src/shared/constants';
import type { PageExtractResult } from '../../../src/shared/types';

const pageGlobals = globalThis as unknown as Record<string, unknown>;
/** Shaped like an Adyen API key (`AQ…==-…=-…`) without being one. */
const FAKE_API_KEY = `AQE${'x'.repeat(40)}==-${'y'.repeat(12)}=-${'z'.repeat(6)}`;

interface VnodeElement extends Element {
  __k?: unknown;
}

/** Runs the page extractor in the current document and reads back the result it publishes. */
async function extractPage(): Promise<PageExtractResult> {
  vi.resetModules();
  await import('../../../src/content/page-extractor');
  const json = pageGlobals[PAGE_GLOBALS.pageExtractResultJson];
  if (typeof json !== 'string') throw new TypeError('The page extractor published no result');
  return JSON.parse(json) as PageExtractResult;
}

/** Wraps a vnode in `depth` parent vnodes. */
function nestVnode(depth: number, vnode: unknown): unknown {
  let tree = vnode;
  for (let level = 0; level < depth; level += 1) tree = { __k: tree };
  return tree;
}

function coreOptions(options: unknown): unknown {
  return { __c: { props: { core: { options } } } };
}

/** Mounts markup whose outer element carries a Preact vnode tree, like a mounted Adyen Web root. */
function mountTree(markup: string, tree: unknown, parent: ParentNode = document.body): Element {
  const mount = document.createElement('div');
  mount.innerHTML = markup;
  (mount as VnodeElement).__k = tree;
  parent.append(mount);
  return mount;
}

function addStyleSheet(css: string): CSSStyleSheet {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  if (style.sheet === null) throw new Error('Expected a parsed stylesheet');
  return style.sheet;
}

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  for (const key of Object.values(PAGE_GLOBALS)) Reflect.deleteProperty(pageGlobals, key);
  Reflect.deleteProperty(pageGlobals, 'AdyenWebMetadata');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('page extractor', () => {
  it('reports an empty top-level page', async () => {
    await expect(extractPage()).resolves.toEqual({
      adyenMetadata: null,
      capturedConfig: null,
      inferredConfig: null,
      pageJsonConfig: null,
      componentConfig: null,
      scripts: [],
      links: [],
      iframes: [],
      observedRequests: [],
      adyenStyles: { classOverrideCount: 0, classOverrideSelectors: [], customPropertyCount: 0 },
      isInsideIframe: false,
      pageUrl: globalThis.location.href,
      pageProtocol: globalThis.location.protocol,
    });
  });

  it('reads the capture record and SDK metadata from page globals', async () => {
    pageGlobals['AdyenWebMetadata'] = { version: '6.31.0', bundleType: 'esm' };
    pageGlobals[PAGE_GLOBALS.checkoutCapture] = {
      captured: { options: { clientKey: 'test_KEY', onSubmit: 'checkout' }, complete: true },
      inferred: { 'adyen-request': { locale: 'nl-NL' }, 'page-json': { countryCode: 'NL' } },
      initCount: 2,
    };

    await expect(extractPage()).resolves.toMatchObject({
      adyenMetadata: { version: '6.31.0', bundleType: 'esm' },
      capturedConfig: { options: { clientKey: 'test_KEY', onSubmit: 'checkout' }, complete: true },
      inferredConfig: { locale: 'nl-NL' },
      pageJsonConfig: { countryCode: 'NL' },
      checkoutInitCount: 2,
    });
  });

  it('tolerates a capture record that page scripts overwrote', async () => {
    pageGlobals[PAGE_GLOBALS.checkoutCapture] = {
      captured: { options: 'x' },
      inferred: { 'adyen-request': {}, 'page-json': 'x' },
      initCount: 'many',
    };

    const page = await extractPage();

    expect(page).toMatchObject({
      capturedConfig: null,
      inferredConfig: null,
      pageJsonConfig: null,
    });
    expect(page).not.toHaveProperty('checkoutInitCount');
  });

  it('collects script, stylesheet and iframe tags with their security attributes', async () => {
    document.body.innerHTML = `
      <script src="https://checkoutshopper-live.cdn.adyen.com/sdk/adyen.js"
        integrity="sha384-abc" crossorigin="anonymous" data-blockingmode="auto"></script>
      <script src="https://merchant.example/app.js" integrity=""></script>
      <script>window.inline = true;</script>
      <link rel="stylesheet" href="https://checkoutshopper-live.cdn.adyen.com/sdk/adyen.css"
        integrity="sha384-def" crossorigin="anonymous">
      <link rel="preconnect" href="https://checkoutshopper-live.adyen.com">
      <iframe name="adyen-card" src="https://checkoutshopper-live.adyen.com/card.html"
        referrerpolicy="origin"></iframe>
      <iframe name=""></iframe>`;

    const page = await extractPage();

    expect(page.scripts).toEqual([
      {
        src: 'https://checkoutshopper-live.cdn.adyen.com/sdk/adyen.js',
        integrity: 'sha384-abc',
        crossorigin: 'anonymous',
        blockingMode: 'auto',
      },
      { src: 'https://merchant.example/app.js' },
    ]);
    expect(page.links).toEqual([
      {
        href: 'https://checkoutshopper-live.cdn.adyen.com/sdk/adyen.css',
        rel: 'stylesheet',
        integrity: 'sha384-def',
        crossorigin: 'anonymous',
      },
      { href: 'https://checkoutshopper-live.adyen.com/', rel: 'preconnect' },
    ]);
    expect(page.iframes).toEqual([
      {
        name: 'adyen-card',
        src: 'https://checkoutshopper-live.adyen.com/card.html',
        referrerpolicy: 'origin',
      },
      {},
    ]);
  });

  it('flags a rendered Drop-in, a new-card form, and the cardholder name field', async () => {
    document.body.innerHTML = `
      <div class="adyen-checkout__dropin">
        <div class="adyen-checkout__card-input">
          <form class="adyen-checkout__card__form">
            <div class="adyen-checkout__card__holderName"></div>
          </form>
        </div>
      </div>`;

    await expect(extractPage()).resolves.toMatchObject({
      hasDropinDOM: true,
      hasCardDOM: true,
      hasNewCardFormDOM: true,
      hasCardHolderNameDOM: true,
    });
  });

  it('does not count a stored-card form as a new-card form', async () => {
    document.body.innerHTML = `
      <div class="adyen-checkout__card-input">
        <form class="adyen-checkout__card__form adyen-checkout__card__form--oneClick"></form>
      </div>`;

    const page = await extractPage();

    expect(page.hasCardDOM).toBe(true);
    expect(page).not.toHaveProperty('hasNewCardFormDOM');
  });

  it('records Resource Timing entries with their initiator and status', async () => {
    vi.spyOn(globalThis.performance, 'getEntriesByType').mockReturnValue([
      {
        name: 'https://checkoutshopper-test.adyen.com/sdk.js',
        initiatorType: 'script',
        responseStatus: 200,
      },
      {
        name: 'https://checkoutshopper-test.adyen.com/v1/sessions',
        initiatorType: '',
        responseStatus: 0,
      },
      { name: '' },
    ] as unknown as PerformanceEntryList);

    await expect(extractPage()).resolves.toMatchObject({
      observedRequests: [
        {
          url: 'https://checkoutshopper-test.adyen.com/sdk.js',
          initiatorType: 'script',
          responseStatus: 200,
        },
        { url: 'https://checkoutshopper-test.adyen.com/v1/sessions' },
      ],
    });
  });
});

describe('page extractor mounted component configuration', () => {
  it('reads Adyen core options from a mounted Preact tree', async () => {
    mountTree(
      '<div class="adyen-checkout__dropin"></div>',
      coreOptions({ clientKey: 'test_TREE', locale: 'nl-NL', analytics: { enabled: false } })
    );

    await expect(extractPage()).resolves.toMatchObject({
      componentConfig: { clientKey: 'test_TREE', locale: 'nl-NL', analyticsEnabled: false },
      componentMountCount: 1,
    });
  });

  it('finds mounts inside shadow roots and merges them, earlier mounts winning', async () => {
    mountTree('<div class="adyen-checkout__card-input"></div>', coreOptions({ locale: 'nl-NL' }));
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    mountTree(
      '<div class="adyen-checkout__dropin"></div>',
      coreOptions({ locale: 'fr-FR', countryCode: 'FR' }),
      shadow
    );

    await expect(extractPage()).resolves.toMatchObject({
      componentConfig: { locale: 'nl-NL', countryCode: 'FR' },
      componentMountCount: 2,
    });
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
  ])('walks the vnode tree to options %s', async (_label, tree) => {
    mountTree('<div class="adyen-checkout__dropin"></div>', tree);

    await expect(extractPage()).resolves.toMatchObject({ componentConfig: { locale: 'a' } });
  });

  it.each([
    ['without core options', { __k: [{ __c: { props: { something: 'else' } } }, { __k: null }] }],
    ['deeper than the walk limit', nestVnode(16, coreOptions({}))],
  ])('reports no component configuration for a tree %s', async (_label, tree) => {
    mountTree('<div class="adyen-checkout__dropin"></div>', tree);

    const page = await extractPage();

    expect(page.componentConfig).toBeNull();
    expect(page).not.toHaveProperty('componentMountCount');
  });

  it('ignores Preact roots on pages without Adyen elements', async () => {
    mountTree('<div class="app"></div>', coreOptions({ clientKey: 'test_OTHER' }));

    await expect(extractPage()).resolves.toMatchObject({ componentConfig: null });
  });
});

describe('page extractor API key exposure', () => {
  it.each([
    [
      'an inline script',
      (): void => {
        const script = document.createElement('script');
        script.textContent = `const key = '${FAKE_API_KEY}';`;
        document.body.append(script);
      },
    ],
    [
      'captured configuration',
      (): void => {
        pageGlobals[PAGE_GLOBALS.checkoutCapture] = {
          captured: { options: { clientKey: FAKE_API_KEY }, complete: false },
        };
      },
    ],
    [
      'inferred configuration',
      (): void => {
        pageGlobals[PAGE_GLOBALS.checkoutCapture] = {
          inferred: { 'page-json': { clientKey: FAKE_API_KEY } },
        };
      },
    ],
  ])('detects an Adyen API key in %s', async (_label, expose) => {
    expose();

    await expect(extractPage()).resolves.toMatchObject({ apiKeyDetected: true });
  });

  it('does not flag client keys', async () => {
    pageGlobals[PAGE_GLOBALS.checkoutCapture] = {
      captured: { options: { clientKey: 'live_ABCDEFGHIJK' }, complete: true },
    };

    await expect(extractPage()).resolves.not.toHaveProperty('apiKeyDetected');
  });
});

describe('page extractor styling', () => {
  it('counts merchant class overrides, including nested rules, and custom properties', async () => {
    addStyleSheet(`
      .adyen-checkout__button { color: red; }
      :root { --adyen-sdk-color-label: #000; --adyen-sdk-color-background: #fff; color: black; }
      @media (min-width: 1px) { .adyen-checkout__input { color: blue; } }
    `);

    await expect(extractPage()).resolves.toMatchObject({
      adyenStyles: {
        classOverrideCount: 2,
        classOverrideSelectors: ['.adyen-checkout__button', '.adyen-checkout__input'],
        customPropertyCount: 2,
      },
    });
  });

  it('keeps at most five sample override selectors', async () => {
    addStyleSheet(
      Array.from({ length: 7 }, (_, i) => `.adyen-checkout__el${i} { color: red; }`).join('\n')
    );

    const { adyenStyles } = await extractPage();

    expect(adyenStyles.classOverrideCount).toBe(7);
    expect(adyenStyles.classOverrideSelectors).toHaveLength(5);
  });

  it("skips Adyen's own stylesheets and cross-origin sheets", async () => {
    const bundled = addStyleSheet(
      Array.from({ length: 50 }, (_, i) => `.adyen-checkout__sdk${i} { color: red; }`).join('\n')
    );
    const merchant = addStyleSheet('.adyen-checkout__merchant { color: red; }');
    const cdn = {
      href: 'https://checkoutshopper-live.cdn.adyen.com/sdk/adyen.css',
      cssRules: merchant.cssRules,
    };
    const crossOrigin = {
      href: 'https://fonts.example/css',
      get cssRules(): CSSRuleList {
        throw new DOMException('Cannot access rules', 'SecurityError');
      },
    };
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([
      bundled,
      cdn,
      crossOrigin,
      merchant,
    ] as unknown as StyleSheetList);

    await expect(extractPage()).resolves.toMatchObject({
      adyenStyles: {
        classOverrideCount: 1,
        classOverrideSelectors: ['.adyen-checkout__merchant'],
        customPropertyCount: 0,
      },
    });
  });
});

describe('page extractor tree walk limits', () => {
  it('reads options from a root far above a deeply nested Adyen element', async () => {
    const deep = `${'<div>'.repeat(12)}<div class="adyen-checkout__card-input"></div>${'</div>'.repeat(12)}`;
    mountTree(deep, coreOptions({ locale: 'nl-NL' }));

    await expect(extractPage()).resolves.toMatchObject({
      componentConfig: { locale: 'nl-NL' },
      componentMountCount: 1,
    });
  });

  it('stops scanning for vnode roots after twenty', async () => {
    document.body.innerHTML = '<div class="adyen-checkout__button"></div>';
    for (let index = 0; index < 25; index += 1) mountTree('<p></p>', coreOptions({ locale: 'a' }));

    await expect(extractPage()).resolves.toMatchObject({ componentMountCount: 20 });
  });

  it('reads an Adyen root mounted directly in a shadow root', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = document.createElement('div');
    root.className = 'adyen-checkout__dropin';
    (root as VnodeElement).__k = coreOptions({ countryCode: 'NL' });
    host.attachShadow({ mode: 'open' }).append(root);

    await expect(extractPage()).resolves.toMatchObject({ componentConfig: { countryCode: 'NL' } });
  });

  it('does not look for shadow hosts nested deeper than seven levels', async () => {
    let parent: Element = document.body;
    for (let level = 0; level < 8; level += 1) {
      const child = document.createElement('div');
      parent.append(child);
      parent = child;
    }
    const shadow = parent.attachShadow({ mode: 'open' });
    mountTree('<div class="adyen-checkout__dropin"></div>', coreOptions({ locale: 'a' }), shadow);

    await expect(extractPage()).resolves.toMatchObject({ componentConfig: null });
  });

  it('does not count trees whose core options are not an object', async () => {
    mountTree('<div class="adyen-checkout__dropin"></div>', coreOptions(42));

    const page = await extractPage();

    expect(page.componentConfig).toBeNull();
    expect(page).not.toHaveProperty('componentMountCount');
  });

  it('skips rules that neither style nor group other rules', async () => {
    addStyleSheet(
      '@font-face { font-family: X; src: url(x.woff2); } .adyen-checkout__button { color: red; }'
    );

    await expect(extractPage()).resolves.toMatchObject({
      adyenStyles: { classOverrideCount: 1 },
    });
  });
});
