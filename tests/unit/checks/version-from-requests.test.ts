import { describe, it, expect } from 'vitest';
import { extractVersionFromRequests } from '../../../src/background/payload-builder';
import { makeRequest } from '../../fixtures/makeScanPayload';

describe('version extraction from CDN request URLs', () => {
  it('extracts version from slash-separated CDN URL', () => {
    const url = 'https://checkoutshopper-test.adyen.com/checkoutshopper-sdk/6.3.1/adyen.js';
    expect(extractVersionFromRequests([makeRequest(url)])).toBe('6.3.1');
  });

  it('extracts version from dot-separated filename', () => {
    const url = 'https://example.com/checkoutshopper-sdk.5.71.0.min.js';
    expect(extractVersionFromRequests([makeRequest(url)])).toBe('5.71.0');
  });

  it('extracts version from legacy v5-style CDN URL', () => {
    const url = 'https://checkoutshopper-live.adyen.com/checkoutshopper/sdk/5.1.0/adyen.js';
    expect(extractVersionFromRequests([makeRequest(url)])).toBe('5.1.0');
  });

  it('extracts version from legacy v4 CDN URL', () => {
    const url = 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/4.7.3/adyen.js';
    expect(extractVersionFromRequests([makeRequest(url)])).toBe('4.7.3');
  });

  it('returns null for non-Adyen URLs', () => {
    const url = 'https://cdn.example.com/some-other-sdk.js';
    expect(extractVersionFromRequests([makeRequest(url)])).toBeNull();
  });
});
