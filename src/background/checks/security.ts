/**
 * Security: SRI and HTTP response header checks.
 */

import type { ScriptTag, LinkTag, IframeInfo } from '../../shared/types.js';
import { resolveEnvironment } from '../../shared/implementation-attributes.js';
import { getHeader, isAdyenCheckoutResource } from '../../shared/utils.js';
import { createRegistry } from './registry.js';

const PCI_GUIDE_URL = 'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/';

const CATEGORY = 'security' as const;

interface SriAttributableResource {
  readonly integrity?: string;
  readonly crossorigin?: string;
}

function hasMissingSriAttributes(resource: SriAttributableResource): boolean {
  return (
    resource.integrity === undefined ||
    resource.integrity === '' ||
    resource.crossorigin === undefined ||
    resource.crossorigin === ''
  );
}

export const SECURITY_CHECKS = createRegistry(CATEGORY)
  .add('security-https', (payload, { pass, fail, skip }) => {
    const isLive = resolveEnvironment(payload).env === 'live';
    if (!isLive) {
      return skip('HTTPS check skipped — test environment.');
    }

    const { pageProtocol } = payload.page;
    if (pageProtocol === 'https:') {
      return pass('Live environment served over HTTPS.');
    }

    return fail(
      'Live environment must be served over HTTPS.',
      `Page protocol is "${pageProtocol}". Payment pages on live environments must use HTTPS.`,
      'Configure TLS/SSL on your server and redirect all HTTP requests to HTTPS before the checkout page loads. Serving a live payment form over plain HTTP exposes card data and session tokens to network interception.',
      PCI_GUIDE_URL
    );
  })
  // SRI Checks
  .add('security-sri-script', (payload, { pass, fail, skip }) => {
    const { scripts } = payload.page;
    const adyenScripts = scripts.filter((s: ScriptTag) => isAdyenCheckoutResource(s.src));

    if (adyenScripts.length === 0) {
      return skip('SRI script check skipped — no Adyen CDN script tags found.');
    }

    const missing = adyenScripts.filter(hasMissingSriAttributes);
    if (missing.length > 0) {
      return fail(
        `${missing.length} Adyen script tag(s) missing SRI attributes.`,
        'Without SRI, a compromised CDN response could inject malicious JavaScript into checkout.',
        'Add integrity and crossorigin="anonymous" attributes to Adyen CDN script tags.',
        'https://docs.adyen.com/online-payments/web-best-practices/#implement-subresource-integrity-hashes'
      );
    }

    return pass('Adyen script tags have SRI attributes.');
  })
  .add('security-sri-css', (payload, { pass, warn, skip }) => {
    const { links } = payload.page;
    const adyenLinks = links.filter((l: LinkTag) => isAdyenCheckoutResource(l.href));

    if (adyenLinks.length === 0) {
      return skip('SRI CSS check skipped — no Adyen CDN stylesheets found.');
    }

    const missing = adyenLinks.filter(hasMissingSriAttributes);
    if (missing.length > 0) {
      return warn(
        `${missing.length} Adyen stylesheet link(s) missing SRI attributes.`,
        'Without SRI, checkout stylesheets can be tampered with and alter payment form behavior.',
        'Add integrity and crossorigin="anonymous" attributes to Adyen CDN stylesheet links.',
        'https://docs.adyen.com/online-payments/web-best-practices/#implement-subresource-integrity-hashes'
      );
    }
    return pass('Adyen stylesheet links have SRI attributes.');
  })
  // Header Checks
  .add('security-referrer-policy', (payload, { pass, notice }) => {
    const value = getHeader(payload, 'Referrer-Policy');
    const recommended = 'strict-origin-when-cross-origin';
    if (
      value !== null &&
      value !== '' &&
      (value === recommended || value === 'no-referrer' || value === 'same-origin')
    ) {
      return pass(`Referrer-Policy is set to "${value}".`);
    }
    return notice(
      value !== null && value !== ''
        ? `Referrer-Policy is "${value}" — consider recommended value.`
        : 'Referrer-Policy header is not set.',
      'A missing or overly permissive referrer policy can leak checkout URL data to third-party origins.',
      'Add a Referrer-Policy header set to strict-origin-when-cross-origin.',
      'https://owasp.org/www-project-secure-headers/#referrer-policy'
    );
  })
  .add('security-x-content-type', (payload, { pass, notice }) => {
    const value = getHeader(payload, 'X-Content-Type-Options');
    if (value?.toLowerCase() === 'nosniff') {
      return pass('X-Content-Type-Options: nosniff is set.');
    }
    return notice(
      'X-Content-Type-Options: nosniff is not set.',
      'Without nosniff, browsers may MIME-sniff responses and execute files as unexpected content types.',
      'Add an X-Content-Type-Options: nosniff header.',
      'https://owasp.org/www-project-secure-headers/#x-content-type-options'
    );
  })
  .add('security-xss-protection', (payload, { pass, notice }) => {
    const value = getHeader(payload, 'X-XSS-Protection');
    if (value === null || value === '' || value === '0') {
      return pass('X-XSS-Protection is absent or disabled (correct).');
    }
    return notice(
      'X-XSS-Protection is set — this is not recommended for modern browsers.',
      'Legacy X-XSS-Protection behavior is inconsistent and should not be relied on for XSS defense.',
      'Remove the X-XSS-Protection header entirely, or set it to 0.',
      'https://owasp.org/www-project-secure-headers/#x-xss-protection'
    );
  })
  .add('security-hsts', (payload, { pass, notice, skip }) => {
    if (resolveEnvironment(payload).env !== 'live') {
      return skip('HSTS check skipped — not a live environment.');
    }
    const value = getHeader(payload, 'Strict-Transport-Security');
    if (value !== null && value !== '') return pass('HSTS header is present.');
    return notice(
      'HSTS header is missing on a live environment.',
      'Without HSTS, browsers can be downgraded to HTTP on later visits, exposing checkout traffic.',
      'Add a Strict-Transport-Security header to your live checkout page.',
      'https://owasp.org/www-project-secure-headers/#strict-transport-security'
    );
  })
  .add('security-iframe-referrerpolicy', (payload, { pass, info }) => {
    const { iframes } = payload.page;
    const adyenIframes = iframes.filter(
      (f: IframeInfo) =>
        f.src !== undefined && f.src !== '' && /\.(adyen\.com|adyenpayments\.com)/.test(f.src)
    );
    if (adyenIframes.length === 0) return info('No Adyen iframes detected.');

    const missing = adyenIframes.filter(
      (f: IframeInfo) => f.referrerpolicy === undefined || f.referrerpolicy === ''
    );
    if (missing.length === 0) return pass('All Adyen iframes have referrerpolicy.');

    return info(
      'Some Adyen iframes are missing referrerpolicy.',
      'Add a referrerpolicy attribute to each Adyen iframe element. See: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#referrerpolicy'
    );
  })
  .getChecks();
