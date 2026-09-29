import { describe, expect, it } from 'vitest';
import { readDocumentHeader, readPagePolicy } from '../../../src/background/checks/page-policy';
import {
  makeHeader,
  makeScanPayload,
  makeDocumentHeaders,
  UNAVAILABLE_DOCUMENT_HEADERS,
} from '../../fixtures/makeScanPayload';

function policyFor(...csp: string[]): ReturnType<typeof readPagePolicy> {
  return readPagePolicy(
    makeScanPayload({
      pageUrl: 'https://merchant.example/checkout',
      documentHeaders: makeDocumentHeaders(
        csp.map((value) => makeHeader('Content-Security-Policy', value))
      ),
    })
  );
}

describe('readDocumentHeader', () => {
  it('tells an unavailable header from an absent one, reading names case-insensitively', () => {
    const payload = makeScanPayload({
      documentHeaders: makeDocumentHeaders([
        makeHeader('X-Frame-Options', 'DENY'),
        makeHeader('x-frame-options', 'SAMEORIGIN'),
      ]),
    });

    expect(readDocumentHeader(payload, 'x-frame-options')).toEqual({
      state: 'present',
      value: 'DENY',
    });
    expect(readDocumentHeader(payload, 'Referrer-Policy')).toEqual({ state: 'absent' });
    expect(
      readDocumentHeader(
        makeScanPayload({ documentHeaders: UNAVAILABLE_DOCUMENT_HEADERS }),
        'X-Frame-Options'
      )
    ).toEqual({ state: 'unavailable' });
  });
});

describe('readPagePolicy', () => {
  it('reports unavailable headers and absent policies', () => {
    expect(
      readPagePolicy(makeScanPayload({ documentHeaders: UNAVAILABLE_DOCUMENT_HEADERS }))
    ).toEqual({
      status: 'unavailable',
    });
    expect(policyFor()).toEqual({ status: 'absent' });
    expect(policyFor(' , ')).toEqual({ status: 'absent' });
  });

  it('allows a URL only when every enforced policy allows it', () => {
    const policy = policyFor(
      'connect-src https://checkoutshopper-live.adyen.com',
      "img-src 'self', connect-src *"
    );
    if (policy.status !== 'enforced') throw new Error('Expected an enforced policy');

    expect(policy.allows('connect-src', 'https://checkoutshopper-live.adyen.com/v1/')).toBe(true);
    expect(policy.allows('connect-src', 'https://checkoutanalytics-live.adyen.com/v3/')).toBe(
      false
    );
  });

  it('exposes governing sources, restrictive policies and declared directives', () => {
    const policy = policyFor("default-src 'self'; report-to csp", 'frame-src *');
    if (policy.status !== 'enforced') throw new Error('Expected an enforced policy');

    expect(policy.governing('frame-src').map((governing) => governing?.directive)).toEqual([
      'default-src',
      'frame-src',
    ]);
    expect(policy.restrictive('frame-src')).toEqual({
      directive: 'default-src',
      sources: ["'self'"],
    });
    expect(policy.governing('form-action')).toEqual([null, null]);
    expect(policy.restrictive('form-action')).toBeUndefined();
    expect(policy.declares('report-to')).toBe(true);
    expect(policy.declares('frame-ancestors')).toBe(false);
  });
});
