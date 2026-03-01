import { describe, it, expect } from 'vitest';
import { SECURITY_CHECKS } from '../../../src/background/checks/security';
import {
  makeScanPayload,
  makeAdyenPayload,
  makeHeader,
  makePageExtract,
  makeCheckoutConfig,
  makeAdyenMetadata,
  makeRequest,
} from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const securityHttps = requireCheck(SECURITY_CHECKS, 'security-https');
const sriScript = requireCheck(SECURITY_CHECKS, 'security-sri-script');
const sriCss = requireCheck(SECURITY_CHECKS, 'security-sri-css');
const referrerPolicy = requireCheck(SECURITY_CHECKS, 'security-referrer-policy');
const xContentType = requireCheck(SECURITY_CHECKS, 'security-x-content-type');
const xssProtection = requireCheck(SECURITY_CHECKS, 'security-xss-protection');
const hsts = requireCheck(SECURITY_CHECKS, 'security-hsts');
const iframeReferrerPolicy = requireCheck(SECURITY_CHECKS, 'security-iframe-referrerpolicy');

describe('Security Checks', () => {
  describe('HTTPS', () => {
    it('passes when live env is served over https', () => {
      const payload = makeAdyenPayload({}, { clientKey: 'live_XXXX', environment: 'live' });
      const result = securityHttps.run(payload);
      expect(result.severity).toBe('pass');
      expect(result.category).toBe('security');
    });

    it('fails when live env is served over http', () => {
      const page = makePageExtract({
        pageProtocol: 'http:',
        pageUrl: 'http://example.com',
        checkoutConfig: makeCheckoutConfig({ clientKey: 'live_XXXX', environment: 'live' }),
        adyenMetadata: makeAdyenMetadata(),
      });
      expect(securityHttps.run(makeScanPayload({ page })).severity).toBe('fail');
    });

    it('skips when test environment', () => {
      const payload = makeScanPayload({
        page: makePageExtract({ pageProtocol: 'http:', pageUrl: 'http://example.com' }),
      });
      expect(securityHttps.run(payload).severity).toBe('skip');
    });

    it('skips when only live CDN traffic (no config env signal)', () => {
      const payload = makeScanPayload({
        page: makePageExtract({ pageProtocol: 'http:', pageUrl: 'http://example.com' }),
        capturedRequests: [
          makeRequest('https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk.js'),
        ],
      });
      expect(securityHttps.run(payload).severity).toBe('skip');
    });
  });

  describe('SRI Scripts', () => {
    it('returns skip when no Adyen scripts are present', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          scripts: [{ src: 'https://example.com/app.js' }],
        }),
      });
      expect(sriScript.run(payload).severity).toBe('skip');
    });

    it('returns pass when Adyen CDN script has SRI attributes', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          scripts: [
            {
              src: 'https://checkoutshopper-test.adyen.com/checkoutshopper-sdk/5.67.0/adyen.js',
              integrity: 'sha384-ABC',
              crossorigin: 'anonymous',
            },
          ],
        }),
      });
      expect(sriScript.run(payload).severity).toBe('pass');
    });

    it('returns fail when Adyen CDN script is missing SRI', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          scripts: [
            { src: 'https://checkoutshopper-test.adyen.com/checkoutshopper-sdk/5.67.0/adyen.js' },
          ],
        }),
      });
      const result = sriScript.run(payload);
      expect(result.severity).toBe('fail');
      expect(result.detail).toContain('Without SRI');
    });

    it('returns warn when Adyen CDN stylesheet is missing SRI', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          links: [
            {
              rel: 'stylesheet',
              href: 'https://checkoutshopper-test.adyen.com/checkoutshopper-sdk/5.67.0/adyen.css',
            },
          ],
        }),
      });
      const result = sriCss.run(payload);
      expect(result.severity).toBe('warn');
      expect(result.detail).toContain('Without SRI');
    });
  });

  describe('SRI CSS', () => {
    it('returns skip when no Adyen stylesheets are present', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          links: [{ rel: 'stylesheet', href: 'https://example.com/app.css' }],
        }),
      });
      expect(sriCss.run(payload).severity).toBe('skip');
    });

    it('returns pass when Adyen CDN stylesheet has SRI attributes', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          links: [
            {
              rel: 'stylesheet',
              href: 'https://checkoutshopper-test.adyen.com/checkoutshopper-sdk/5.67.0/adyen.css',
              integrity: 'sha384-ABC',
              crossorigin: 'anonymous',
            },
          ],
        }),
      });
      expect(sriCss.run(payload).severity).toBe('pass');
    });
  });

  describe('Referrer-Policy', () => {
    it('passes when strict policy is set', () => {
      const payload = makeScanPayload({
        mainDocumentHeaders: [makeHeader('referrer-policy', 'strict-origin-when-cross-origin')],
      });
      expect(referrerPolicy.run(payload).severity).toBe('pass');
    });

    it('returns notice when header is missing', () => {
      const payload = makeScanPayload({ mainDocumentHeaders: [] });
      const result = referrerPolicy.run(payload);
      expect(result.severity).toBe('notice');
      expect(result.detail).toContain('referrer policy');
    });

    it('passes when same-origin is set', () => {
      const payload = makeScanPayload({
        mainDocumentHeaders: [makeHeader('Referrer-Policy', 'same-origin')],
      });
      expect(referrerPolicy.run(payload).severity).toBe('pass');
    });
  });

  describe('X-Content-Type-Options', () => {
    it('passes when nosniff is set', () => {
      const payload = makeScanPayload({
        mainDocumentHeaders: [makeHeader('x-content-type-options', 'nosniff')],
      });
      expect(xContentType.run(payload).severity).toBe('pass');
    });

    it('returns notice with impact detail when nosniff is missing', () => {
      const payload = makeScanPayload({
        mainDocumentHeaders: [],
      });
      const result = xContentType.run(payload);
      expect(result.severity).toBe('notice');
      expect(result.detail).toContain('MIME-sniff');
    });
  });

  describe('HSTS', () => {
    it('skips on non-live environment', () => {
      const payload = makeScanPayload(); // default is test
      expect(hsts.run(payload).severity).toBe('skip');
    });

    it('returns notice with impact detail when missing on live', () => {
      const payload = makeAdyenPayload({}, { clientKey: 'live_XXXX', environment: 'live' });
      const result = hsts.run(payload);
      expect(result.severity).toBe('notice');
      expect(result.detail).toContain('downgraded to HTTP');
    });

    it('passes when present on live', () => {
      const payload = makeAdyenPayload(
        {},
        { clientKey: 'live_XXXX', environment: 'live' },
        {
          mainDocumentHeaders: [makeHeader('strict-transport-security', 'max-age=31536000')],
        }
      );
      expect(hsts.run(payload).severity).toBe('pass');
    });
  });

  describe('X-XSS-Protection', () => {
    it('passes when header is disabled', () => {
      const payload = makeScanPayload({
        mainDocumentHeaders: [makeHeader('x-xss-protection', '0')],
      });
      expect(xssProtection.run(payload).severity).toBe('pass');
    });

    it('returns notice when header is enabled', () => {
      const payload = makeScanPayload({
        mainDocumentHeaders: [makeHeader('x-xss-protection', '1; mode=block')],
      });
      const result = xssProtection.run(payload);
      expect(result.severity).toBe('notice');
      expect(result.detail).toContain('Legacy X-XSS-Protection');
    });
  });

  describe('Iframe referrerpolicy', () => {
    it('returns info when no Adyen iframes are present', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          iframes: [{ src: 'https://example.com/embedded-content' }],
        }),
      });
      expect(iframeReferrerPolicy.run(payload).severity).toBe('info');
    });

    it('passes when all Adyen iframes have referrerpolicy', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          iframes: [
            {
              src: 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/iframe.html',
              referrerpolicy: 'origin',
            },
            {
              src: 'https://checkout-live.adyenpayments.com/checkout',
              referrerpolicy: 'strict-origin-when-cross-origin',
            },
          ],
        }),
      });
      expect(iframeReferrerPolicy.run(payload).severity).toBe('pass');
    });

    it('returns info when an Adyen iframe is missing referrerpolicy', () => {
      const payload = makeScanPayload({
        page: makePageExtract({
          iframes: [
            {
              src: 'https://checkoutshopper-test.adyen.com/checkoutshopper/sdk/iframe.html',
            },
          ],
        }),
      });
      const result = iframeReferrerPolicy.run(payload);
      expect(result.severity).toBe('info');
      expect(result.title).toContain('missing referrerpolicy');
    });
  });
});
