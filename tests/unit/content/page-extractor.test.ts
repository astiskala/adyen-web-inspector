import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_GLOBALS } from '../../../src/shared/constants';
import type { PageExtractResult } from '../../../src/shared/types';

const pageGlobals = globalThis as unknown as Record<string, unknown>;

function patchedToJson(): string {
  return 'patched';
}
/**
Shaped like an Adyen API key (`AQ…==-…=-…`) without being one.
*/
const FAKE_API_KEY = `AQE${'x'.repeat(40)}==-${'y'.repeat(12)}=-${'z'.repeat(6)}`;

interface VnodeElement extends Element {
  __k?: unknown;
}

/**
Runs the page extractor in the current document and reads back the result it publishes.
*/
async function extractPage(): Promise<PageExtractResult> {
  vi.resetModules();
  await import('../../../src/content/page-extractor');
  const json = pageGlobals[PAGE_GLOBALS.pageExtractResultJson];
  if (typeof json !== 'string') throw new TypeError('The page extractor published no result');
  return JSON.parse(json) as PageExtractResult;
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
      observedConfig: { captured: null, component: null, inferred: {} },
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

  it.each([
    [
      { version: 6, bundleType: 'umd', variants: ['card', 3], secret: 'x' },
      { bundleType: 'umd', variants: ['card'] },
    ],
    ['6.31.0', null],
  ])('keeps only typed SDK metadata fields from %j', async (metadata, expected) => {
    pageGlobals['AdyenWebMetadata'] = metadata;

    const page = await extractPage();
    expect(page.adyenMetadata).toEqual(expected);
  });

  it('serialises plainly on pages that give built-in prototypes a toJSON, as Prototype.js does', async () => {
    // eslint-disable-next-line no-extend-native -- Reproduces Prototype.js, which patches Array.prototype.
    Object.defineProperty(Array.prototype, 'toJSON', {
      value: patchedToJson,
      configurable: true,
      writable: true,
    });
    try {
      document.body.innerHTML = '<script src="https://shop.example/app.js"></script>';

      const page = await extractPage();
      expect(Array.isArray(page.scripts)).toBe(true);
      expect(Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')?.value).toBe(patchedToJson);
    } finally {
      Reflect.deleteProperty(Array.prototype, 'toJSON');
    }
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
      observedConfig: {
        captured: { options: { clientKey: 'test_KEY', onSubmit: 'checkout' }, complete: true },
        inferred: { 'adyen-request': { locale: 'nl-NL' }, 'page-json': { countryCode: 'NL' } },
      },
      checkoutInitCount: 2,
    });
  });

  it('publishes the analytics of the capture record when they report anything', async () => {
    const analytics = {
      sdk: { flavor: 'dropin' },
      rendered: [{ type: 'paypal', showPayButton: false }],
      paymentMethods: ['paypal'],
    };
    pageGlobals[PAGE_GLOBALS.checkoutCapture] = { analytics };
    await expect(extractPage()).resolves.toMatchObject({ analytics });

    pageGlobals[PAGE_GLOBALS.checkoutCapture] = {
      analytics: { sdk: {}, rendered: [], paymentMethods: [] },
    };
    await expect(extractPage()).resolves.not.toHaveProperty('analytics');
  });

  it('tolerates a capture record that page scripts overwrote', async () => {
    pageGlobals[PAGE_GLOBALS.checkoutCapture] = {
      captured: { options: 'x' },
      inferred: { 'adyen-request': {}, 'page-json': 'x' },
      initCount: 'many',
    };

    const page = await extractPage();

    expect(page).toMatchObject({
      observedConfig: { captured: null, inferred: {} },
    });
    expect(page).not.toHaveProperty('checkoutInitCount');
  });

  it('collects script, stylesheet and iframe tags with their security attributes', async () => {
    document.body.innerHTML = `
      <script src="https://checkoutshopper-live.cdn.adyen.com/sdk/adyen.js"
        integrity="sha384-abc" crossorigin="anonymous" data-blockingmode="auto"
        nonce="r4nd0m"></script>
      <script src="https://merchant.example/app.js" integrity="" nonce=""></script>
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
        nonce: 'r4nd0m',
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

    const page = await extractPage();
    expect(page.observedRequests).toEqual([
      {
        url: 'https://checkoutshopper-test.adyen.com/sdk.js',
        initiatorType: 'script',
        responseStatus: 200,
      },
      { url: 'https://checkoutshopper-test.adyen.com/v1/sessions' },
    ]);
  });

  it('adds checkout requests the interceptor recorded after the browser buffer filled, once each', async () => {
    const sessions = {
      name: 'https://checkoutshopper-test.adyen.com/checkoutshopper/v1/sessions',
      initiatorType: 'fetch',
      responseStatus: 200,
    };
    const late = { name: 'https://shop.example/api/v71/payments/details', initiatorType: 'fetch' };
    vi.spyOn(globalThis.performance, 'getEntriesByType').mockReturnValue([
      sessions,
    ] as unknown as PerformanceEntryList);
    pageGlobals[PAGE_GLOBALS.observedResources] = [sessions, late, 'tampered', null];

    const page = await extractPage();
    expect(page.observedRequests).toEqual([
      { url: sessions.name, initiatorType: 'fetch', responseStatus: 200 },
      { url: late.name, initiatorType: 'fetch' },
    ]);
  });

  it('ignores a recorded-resources global the page replaced', async () => {
    vi.spyOn(globalThis.performance, 'getEntriesByType').mockReturnValue([]);
    pageGlobals[PAGE_GLOBALS.observedResources] = { length: 1 };

    const page = await extractPage();
    expect(page.observedRequests).toEqual([]);
  });

  it('records only the requests a scan reads, not other third-party resources', async () => {
    const kept = [
      'https://shop.example/api/v71/sessions',
      'https://shop.example/vendor/checkoutshopper/sdk/6.31.0/adyen.js',
      'https://shop.example/static/translations/nl-NL.json',
      'https://shop.example/assets/html/K/dfp.1.0.0.html',
    ];
    const dropped = [
      'https://www.facebook.com/tr?id=1&ud[em]=hashed-email',
      'https://shop.example/img/logo.png?session=abc',
    ];
    vi.spyOn(globalThis.performance, 'getEntriesByType').mockReturnValue(
      [...dropped, ...kept].map((name) => ({ name })) as unknown as PerformanceEntryList
    );

    const page = await extractPage();
    expect(page.observedRequests?.map(({ url }) => url)).toEqual(kept);
  });
});

describe('page extractor mounted component configuration', () => {
  it('reads Adyen core options from a mounted Preact tree', async () => {
    mountTree(
      '<div class="adyen-checkout__dropin"></div>',
      coreOptions({ clientKey: 'test_TREE', locale: 'nl-NL', analytics: { enabled: false } })
    );

    await expect(extractPage()).resolves.toMatchObject({
      observedConfig: {
        component: { clientKey: 'test_TREE', locale: 'nl-NL', analyticsEnabled: false },
      },
      componentMountCount: 1,
    });
  });

  it("reads Drop-in's per-method configuration from the props that carry the core", async () => {
    mountTree('<div class="adyen-checkout__dropin"></div>', {
      __c: {
        props: {
          core: { options: { showPayButton: true } },
          paymentMethodsConfiguration: { paypal: { showPayButton: false } },
        },
      },
    });

    await expect(extractPage()).resolves.toMatchObject({
      observedConfig: { component: { showPayButton: true, hiddenPayButtonMethods: ['paypal'] } },
    });
  });

  it('counts components created from one AdyenCheckout as one instance', async () => {
    const shared = coreOptions({ locale: 'nl-NL' });
    mountTree('<div class="adyen-checkout__card-input"></div>', shared);
    mountTree('<div class="adyen-checkout__ideal"></div>', shared);

    await expect(extractPage()).resolves.toMatchObject({ componentMountCount: 1 });
  });

  it('reads checkout in a closed shadow root the interceptor recorded, nested open roots included', async () => {
    const host = document.createElement('payment-widget');
    document.body.append(host);
    const closed = host.attachShadow({ mode: 'closed' });
    const innerHost = document.createElement('div');
    closed.append(innerHost);
    const open = innerHost.attachShadow({ mode: 'open' });
    mountTree('<div class="adyen-checkout__dropin"></div>', coreOptions({ locale: 'pl-PL' }), open);
    pageGlobals[PAGE_GLOBALS.closedShadowRoots] = new WeakMap([[host, closed]]);

    await expect(extractPage()).resolves.toMatchObject({
      observedConfig: { component: { locale: 'pl-PL' } },
      hasDropinDOM: true,
    });
  });

  it('reads checkout in a closed root a custom element reaches through its internals', async () => {
    class PaymentPanel extends HTMLElement {
      readonly internals = this.attachInternals();
    }
    customElements.define('payment-panel-internals', PaymentPanel);
    const host = new PaymentPanel();
    document.body.append(host);
    const closed = host.attachShadow({ mode: 'closed' });
    mountTree(
      '<div class="adyen-checkout__dropin"></div>',
      coreOptions({ locale: 'da-DK' }),
      closed
    );
    pageGlobals[PAGE_GLOBALS.elementInternals] = [
      new WeakRef(host.internals),
      new WeakRef({}),
      'tampered',
    ];

    await expect(extractPage()).resolves.toMatchObject({
      observedConfig: { component: { locale: 'da-DK' } },
    });
  });

  it('ignores an internals record the page replaced', async () => {
    pageGlobals[PAGE_GLOBALS.elementInternals] = { length: 1 };

    await expect(extractPage()).resolves.toMatchObject({ observedConfig: { component: null } });
  });

  it('ignores a closed-root record the page overwrote', async () => {
    const host = document.createElement('payment-widget');
    document.body.append(host);
    host.attachShadow({ mode: 'closed' }).innerHTML = '<div class="adyen-checkout__dropin"></div>';
    pageGlobals[PAGE_GLOBALS.closedShadowRoots] = { get: (): null => null };

    const page = await extractPage();
    expect(page).not.toHaveProperty('hasDropinDOM');
  });

  it('reads a checkout mounted in a shadow root deep in the page', async () => {
    let parent: HTMLElement = document.body;
    for (let level = 0; level < 10; level += 1) {
      const child = document.createElement('section');
      parent.append(child);
      parent = child;
    }
    const shadow = parent.attachShadow({ mode: 'open' });
    mountTree(
      '<div class="adyen-checkout__dropin"></div>',
      coreOptions({ locale: 'sv-SE' }),
      shadow
    );

    await expect(extractPage()).resolves.toMatchObject({
      observedConfig: { component: { locale: 'sv-SE' } },
      hasDropinDOM: true,
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
      observedConfig: { component: { locale: 'nl-NL', countryCode: 'FR' } },
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

    await expect(extractPage()).resolves.toMatchObject({
      observedConfig: { component: { locale: 'a' } },
    });
  });

  it.each([
    ['without core options', { __k: [{ __c: { props: { something: 'else' } } }, { __k: null }] }],
    ['deeper than the walk limit', nestVnode(16, coreOptions({}))],
  ])('reports no component configuration for a tree %s', async (_label, tree) => {
    mountTree('<div class="adyen-checkout__dropin"></div>', tree);

    const page = await extractPage();

    expect(page.observedConfig.component).toBeNull();
    expect(page).not.toHaveProperty('componentMountCount');
  });

  it('ignores Preact roots on pages without Adyen elements', async () => {
    mountTree('<div class="app"></div>', coreOptions({ clientKey: 'test_OTHER' }));

    await expect(extractPage()).resolves.toMatchObject({ observedConfig: { component: null } });
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

  it('scans a large inline base64 blob in linear time', async () => {
    // Random-looking base64 holds many "AQ" pairs and no key delimiters.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let seed = 7;
    const blob = Array.from({ length: 3_000_000 }, () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return alphabet[(seed >>> 16) % 64];
    }).join('');
    const script = document.createElement('script');
    script.textContent = `var font = "${blob}";`;
    document.head.append(script);

    const started = performance.now();
    await expect(extractPage()).resolves.not.toHaveProperty('apiKeyDetected');
    expect(performance.now() - started).toBeLessThan(750);
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
      Array.from({ length: 7 }, (_, index) => `.adyen-checkout__el${index} { color: red; }`).join(
        '\n'
      )
    );

    const { adyenStyles } = await extractPage();

    expect(adyenStyles.classOverrideCount).toBe(7);
    expect(adyenStyles.classOverrideSelectors).toHaveLength(5);
  });

  it("skips Adyen's own stylesheets and cross-origin sheets", async () => {
    const bundled = addStyleSheet(
      Array.from({ length: 50 }, (_, index) => `.adyen-checkout__sdk${index} { color: red; }`).join(
        '\n'
      )
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
      observedConfig: { component: { locale: 'nl-NL' } },
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

    await expect(extractPage()).resolves.toMatchObject({
      observedConfig: { component: { countryCode: 'NL' } },
    });
  });

  it('does not count trees whose core options are not an object', async () => {
    mountTree('<div class="adyen-checkout__dropin"></div>', coreOptions(42));

    const page = await extractPage();

    expect(page.observedConfig.component).toBeNull();
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
