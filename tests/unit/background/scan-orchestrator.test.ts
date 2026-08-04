import { describe, expect, it } from 'vitest';
import { selectPageExtractResult } from '../../../src/background/scan-orchestrator';
import type { PageExtractResult } from '../../../src/shared/types';
import {
  makeAdyenMetadata,
  makeCheckoutConfig,
  makePageExtract,
} from '../../fixtures/makeScanPayload';

function makeFrame(
  frameId: number,
  result?: PageExtractResult
): chrome.scripting.InjectionResult<PageExtractResult> {
  return {
    frameId,
    documentId: `document-${frameId}`,
    ...(result === undefined ? {} : { result }),
  };
}

function makeNullFrame(frameId: number): chrome.scripting.InjectionResult<PageExtractResult> {
  return {
    frameId,
    documentId: `document-${frameId}`,
    result: null,
  } as unknown as chrome.scripting.InjectionResult<PageExtractResult>;
}

describe('selectPageExtractResult', () => {
  it('selects a child frame containing checkout configuration', () => {
    const top = makeFrame(
      0,
      makePageExtract({
        adyenMetadata: makeAdyenMetadata({ version: '6.30.0' }),
        pageUrl: 'https://merchant.example/',
      })
    );
    const checkoutFrame = makeFrame(
      7,
      makePageExtract({
        checkoutConfig: makeCheckoutConfig(),
        pageUrl: 'https://merchant.example/embedded-checkout',
      })
    );

    const result = selectPageExtractResult([top, checkoutFrame], 1);

    expect(result.pageUrl).toBe('https://merchant.example/embedded-checkout');
    expect(result.isInsideIframe).toBe(true);
    expect(result.adyenMetadata?.version).toBe('6.30.0');
  });

  it('prefers top-frame checkout configuration over weaker child-frame signals', () => {
    const top = makeFrame(
      0,
      makePageExtract({
        checkoutConfig: makeCheckoutConfig(),
        pageUrl: 'https://merchant.example/checkout',
      })
    );
    const adyenChild = makeFrame(
      4,
      makePageExtract({
        adyenMetadata: makeAdyenMetadata(),
        pageUrl: 'https://checkoutshopper-test.adyen.com/internal',
      })
    );

    const result = selectPageExtractResult([adyenChild, top], 1);

    expect(result.pageUrl).toBe('https://merchant.example/checkout');
    expect(result.isInsideIframe).toBe(false);
  });

  it('uses the top frame when frames have equal signal strength', () => {
    const child = makeFrame(2, makePageExtract({ pageUrl: 'https://child.example/' }));
    const top = makeFrame(0, makePageExtract({ pageUrl: 'https://merchant.example/' }));

    const result = selectPageExtractResult([child, top], 1);

    expect(result.pageUrl).toBe('https://merchant.example/');
    expect(result.isInsideIframe).toBe(false);
  });

  it('throws when no frame returned an extraction result', () => {
    expect(() => selectPageExtractResult([makeFrame(0)], 9)).toThrow(
      'Page extraction returned no frame results for tab 9'
    );
  });

  it('ignores frames that return null', () => {
    const checkoutFrame = makeFrame(3, makePageExtract({ checkoutConfig: makeCheckoutConfig() }));

    expect(selectPageExtractResult([makeNullFrame(0), checkoutFrame], 1).isInsideIframe).toBe(true);
  });
});
