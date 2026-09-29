import { describe, expect, it, vi } from 'vitest';
import { findSdkVersionInUrls, resolveVersionInfo } from '../../../src/shared/sdk-version';
import type { AnalyticsData, CheckoutPage } from '../../../src/shared/types';
import { makeAdyenMetadata, makeCheckoutPage, makeRequest } from '../../fixtures/makeScanPayload';

type Evidence = Parameters<typeof resolveVersionInfo>[0];

const PAGE_URL = 'https://merchant.example/checkout';

function evidenceWith(
  page: Partial<CheckoutPage> = {},
  overrides: Partial<Evidence> = {}
): Evidence {
  return {
    page: makeCheckoutPage({ pageUrl: PAGE_URL, ...page }),
    analyticsData: null,
    capturedRequests: [],
    latest: '6.40.0',
    ...overrides,
  };
}

/** An in-memory script server for the bundle-text signal. */
function serveScripts(
  texts: Readonly<Record<string, string>>
): ReturnType<typeof vi.fn<(url: string) => Promise<string | null>>> {
  return vi.fn(async (url: string) => texts[url] ?? null);
}

describe('resolveVersionInfo signal precedence', () => {
  const cdnScript = 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.22.0/adyen.js';
  const cdnRequest = makeRequest(
    'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/6.21.0/adyen.css'
  );
  const analytics: AnalyticsData = { version: '6.23.0' };

  it.each([
    {
      name: 'metadata',
      evidence: evidenceWith(
        { adyenMetadata: makeAdyenMetadata({ version: '6.30.0' }), scripts: [{ src: cdnScript }] },
        { analyticsData: analytics, capturedRequests: [cdnRequest] }
      ),
      expected: { detected: '6.30.0', source: 'metadata' },
    },
    {
      name: 'analytics',
      evidence: evidenceWith(
        { scripts: [{ src: cdnScript }] },
        { analyticsData: analytics, capturedRequests: [cdnRequest] }
      ),
      expected: { detected: '6.23.0', source: 'analytics' },
    },
    {
      name: 'script-url',
      evidence: evidenceWith({ scripts: [{ src: cdnScript }] }, { capturedRequests: [cdnRequest] }),
      expected: { detected: '6.22.0', source: 'script-url' },
    },
    {
      name: 'request-url',
      evidence: evidenceWith(
        { adyenMetadata: makeAdyenMetadata({ version: '' }) },
        { analyticsData: { version: '' }, capturedRequests: [cdnRequest] }
      ),
      expected: { detected: '6.21.0', source: 'request-url' },
    },
  ])(
    'prefers $name over weaker signals without fetching bundles',
    async ({ evidence, expected }) => {
      const fetchScriptText = serveScripts({});

      await expect(resolveVersionInfo(evidence, fetchScriptText)).resolves.toMatchObject(expected);
      expect(fetchScriptText).not.toHaveBeenCalled();
    }
  );

  it('attaches the npm release date of the detected version when known', async () => {
    const releaseDates = { '6.30.0': '2026-01-10T00:00:00.000Z' };
    const page = { adyenMetadata: makeAdyenMetadata({ version: '6.30.0' }) };

    await expect(
      resolveVersionInfo(evidenceWith(page, { releaseDates }), serveScripts({}))
    ).resolves.toEqual({
      detected: '6.30.0',
      source: 'metadata',
      latest: '6.40.0',
      detectedReleasedAt: '2026-01-10T00:00:00.000Z',
    });
    await expect(
      resolveVersionInfo(
        evidenceWith(page, { releaseDates: { '6.31.0': '2026-02-01T00:00:00.000Z' } }),
        serveScripts({})
      )
    ).resolves.not.toHaveProperty('detectedReleasedAt');
  });

  it('reports no version or source when no signal yields one', async () => {
    await expect(
      resolveVersionInfo(evidenceWith({}, { latest: null }), serveScripts({}))
    ).resolves.toEqual({ detected: null, latest: null });
  });
});

describe('resolveVersionInfo bundle text', () => {
  it('fetches prioritised same-origin bundles once each and reads a valid version', async () => {
    const fetchScriptText = serveScripts({
      'https://merchant.example/main.js': '/* @adyen/adyen-web 6.10.2 */',
      'https://merchant.example/chunk.js': 'adyen-web 6.9.1',
    });
    const evidence = evidenceWith({
      scripts: [
        { src: 'https://cdn.example/vendor.js' },
        { src: 'https://merchant.example/chunk.js' },
        { src: 'https://merchant.example/main.js' },
        { src: 'https://merchant.example/main.js' },
      ],
    });

    await expect(resolveVersionInfo(evidence, fetchScriptText)).resolves.toMatchObject({
      detected: '6.10.2',
      source: 'bundle',
    });
    expect(fetchScriptText.mock.calls).toEqual([['https://merchant.example/main.js']]);
  });

  it('continues past unusable bundles and accepts a later pattern', async () => {
    const fetchScriptText = serveScripts({
      'https://merchant.example/vendor.js': 'adyen-web 6.invalid.0',
      'https://merchant.example/bundle.js': '',
      'https://merchant.example/chunk.js': 'checkoutshopper build 6.11.0',
    });
    const evidence = evidenceWith({
      scripts: [
        { src: 'https://merchant.example/chunk.js' },
        { src: 'https://merchant.example/missing.js' },
        { src: 'https://merchant.example/bundle.js' },
        { src: 'https://merchant.example/vendor.js' },
      ],
    });

    await expect(resolveVersionInfo(evidence, fetchScriptText)).resolves.toMatchObject({
      detected: '6.11.0',
      source: 'bundle',
    });
    expect(fetchScriptText.mock.calls.map(([url]) => url)).toEqual([
      'https://merchant.example/vendor.js',
      'https://merchant.example/bundle.js',
      'https://merchant.example/chunk.js',
    ]);
  });

  it('fetches at most four bundles', async () => {
    const fetchScriptText = serveScripts({ 'https://merchant.example/e.js': 'adyen-web 6.1.0' });
    const evidence = evidenceWith({
      scripts: ['a', 'b', 'c', 'd', 'e'].map((name) => ({
        src: `https://merchant.example/${name}.js`,
      })),
    });

    await expect(resolveVersionInfo(evidence, fetchScriptText)).resolves.toMatchObject({
      detected: null,
    });
    expect(fetchScriptText).toHaveBeenCalledTimes(4);
  });

  it('fetches nothing without a valid page hostname', async () => {
    const fetchScriptText = serveScripts({});
    const evidence = evidenceWith({
      pageUrl: 'not a URL',
      scripts: [{ src: 'https://merchant.example/main.js' }],
    });

    await expect(resolveVersionInfo(evidence, fetchScriptText)).resolves.toMatchObject({
      detected: null,
    });
    expect(fetchScriptText).not.toHaveBeenCalled();
  });
});

describe('findSdkVersionInUrls', () => {
  it.each([
    [
      'a slash-separated CDN URL',
      'https://checkoutshopper-test.adyen.com/checkoutshopper-sdk/6.3.1/adyen.js',
      '6.3.1',
    ],
    ['a dot-separated filename', 'https://example.com/checkoutshopper-sdk.5.71.0.min.js', '5.71.0'],
    [
      'a legacy CDN URL',
      'https://checkoutshopper-live.adyen.com/checkoutshopper/sdk/5.1.0/adyen.js',
      '5.1.0',
    ],
  ])('reads %s', (_label, url, version) => {
    expect(findSdkVersionInUrls([url])).toBe(version);
  });

  it('returns null for URLs without an SDK version', () => {
    expect(findSdkVersionInUrls(['https://cdn.example.com/some-other-sdk.js'])).toBeNull();
    expect(findSdkVersionInUrls([])).toBeNull();
  });
});
