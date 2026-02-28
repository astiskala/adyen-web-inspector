/**
 * Security: SRI and HTTP response header checks.
 */

import type { ScriptTag, LinkTag, IframeInfo } from '../../shared/types.js';
import { resolveEnvironment } from '../../shared/implementation-attributes.js';
import { getHeader, isAdyenCheckoutResource } from '../../shared/utils.js';
import { createRegistry } from './registry.js';

const PCI_GUIDE_URL = 'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/';

const SRI_URL =
  'https://docs.adyen.com/online-payments/web-best-practices/#implement-subresource-integrity-hashes';

const STRINGS = {
  HTTPS_SKIP_TITLE: 'HTTPS check skipped.',
  HTTPS_SKIP_REASON: 'Not required for test environment.',
  HTTPS_PASS_TITLE: 'Live environment served over HTTPS.',
  HTTPS_FAIL_TITLE: 'Live environment must be served over HTTPS.',
  // HTTPS_FAIL_DETAIL stays inline (dynamic: uses pageProtocol)
  HTTPS_FAIL_REMEDIATION:
    'Configure TLS/SSL on your server and redirect all HTTP requests to HTTPS before the checkout page loads. Serving a live payment form over plain HTTP exposes card data and session tokens to network interception.',
  HTTPS_FAIL_URL: PCI_GUIDE_URL,

  SRI_SCRIPT_SKIP_TITLE: 'SRI script check skipped.',
  SRI_SCRIPT_SKIP_REASON: 'No Adyen CDN script tags found.',
  // SRI_SCRIPT_FAIL_TITLE stays inline (dynamic: uses missing.length)
  SRI_SCRIPT_FAIL_DETAIL:
    'Without SRI, a compromised CDN response could inject malicious JavaScript into checkout.',
  SRI_SCRIPT_FAIL_REMEDIATION:
    'Add integrity and crossorigin="anonymous" attributes to Adyen CDN script tags.',
  SRI_SCRIPT_FAIL_URL: SRI_URL,
  SRI_SCRIPT_PASS_TITLE: 'Adyen script tags have SRI attributes.',

  SRI_CSS_SKIP_TITLE: 'SRI CSS check skipped.',
  SRI_CSS_SKIP_REASON: 'No Adyen CDN stylesheets found.',
  // SRI_CSS_WARN_TITLE stays inline (dynamic: uses missing.length)
  SRI_CSS_WARN_DETAIL:
    'Without SRI, checkout stylesheets can be tampered with and alter payment form behavior.',
  SRI_CSS_WARN_REMEDIATION:
    'Add integrity and crossorigin="anonymous" attributes to Adyen CDN stylesheet links.',
  SRI_CSS_WARN_URL: SRI_URL,
  SRI_CSS_PASS_TITLE: 'Adyen stylesheet links have SRI attributes.',

  REFERRER_POLICY_NOT_SET_NOTICE_TITLE: 'Referrer-Policy header is not set.',
  REFERRER_POLICY_NOTICE_DETAIL:
    'A missing or overly permissive referrer policy can leak checkout URL data to third-party origins.',
  REFERRER_POLICY_NOTICE_REMEDIATION:
    'Add a Referrer-Policy header set to strict-origin-when-cross-origin.',
  REFERRER_POLICY_NOTICE_URL: 'https://owasp.org/www-project-secure-headers/#referrer-policy',

  XCTO_PASS_TITLE: 'X-Content-Type-Options: nosniff is set.',
  XCTO_NOTICE_TITLE: 'X-Content-Type-Options: nosniff is not set.',
  XCTO_NOTICE_DETAIL:
    'Without nosniff, browsers may MIME-sniff responses and execute files as unexpected content types.',
  XCTO_NOTICE_REMEDIATION: 'Add an X-Content-Type-Options: nosniff header.',
  XCTO_NOTICE_URL: 'https://owasp.org/www-project-secure-headers/#x-content-type-options',

  XSS_PASS_TITLE: 'X-XSS-Protection is absent or disabled (correct).',
  XSS_NOTICE_TITLE: 'X-XSS-Protection is set — this is not recommended for modern browsers.',
  XSS_NOTICE_DETAIL:
    'Legacy X-XSS-Protection behavior is inconsistent and should not be relied on for XSS defense.',
  XSS_NOTICE_REMEDIATION: 'Remove the X-XSS-Protection header entirely, or set it to 0.',
  XSS_NOTICE_URL: 'https://owasp.org/www-project-secure-headers/#x-xss-protection',

  HSTS_SKIP_TITLE: 'HSTS check skipped.',
  HSTS_SKIP_REASON: 'Not a live environment.',
  HSTS_PASS_TITLE: 'HSTS header is present.',
  HSTS_NOTICE_TITLE: 'HSTS header is missing on a live environment.',
  HSTS_NOTICE_DETAIL:
    'Without HSTS, browsers can be downgraded to HTTP on later visits, exposing checkout traffic.',
  HSTS_NOTICE_REMEDIATION: 'Add a Strict-Transport-Security header to your live checkout page.',
  HSTS_NOTICE_URL: 'https://owasp.org/www-project-secure-headers/#strict-transport-security',

  IFRAME_RP_NO_ADYEN_INFO_TITLE: 'No Adyen iframes detected.',
  IFRAME_RP_PASS_TITLE: 'All Adyen iframes have referrerpolicy.',
  IFRAME_RP_MISSING_INFO_TITLE: 'Some Adyen iframes are missing referrerpolicy.',
  IFRAME_RP_MISSING_INFO_DETAIL:
    'Add a referrerpolicy attribute to each Adyen iframe element. See: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#referrerpolicy',
} as const;

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
    const env = resolveEnvironment(payload).env;
    const isLive = env === 'live' || env === 'live-in';
    if (!isLive) {
      return skip(STRINGS.HTTPS_SKIP_TITLE, STRINGS.HTTPS_SKIP_REASON);
    }

    const { pageProtocol } = payload.page;
    if (pageProtocol === 'https:') {
      return pass(STRINGS.HTTPS_PASS_TITLE);
    }

    return fail(
      STRINGS.HTTPS_FAIL_TITLE,
      `Page protocol is "${pageProtocol}". Payment pages on live environments must use HTTPS.`,
      STRINGS.HTTPS_FAIL_REMEDIATION,
      STRINGS.HTTPS_FAIL_URL
    );
  })
  // SRI Checks
  .add('security-sri-script', (payload, { pass, fail, skip }) => {
    const { scripts } = payload.page;
    const adyenScripts = scripts.filter((s: ScriptTag) => isAdyenCheckoutResource(s.src));

    if (adyenScripts.length === 0) {
      return skip(STRINGS.SRI_SCRIPT_SKIP_TITLE, STRINGS.SRI_SCRIPT_SKIP_REASON);
    }

    const missing = adyenScripts.filter(hasMissingSriAttributes);
    if (missing.length > 0) {
      return fail(
        `${missing.length} Adyen script tag(s) missing SRI attributes.`,
        STRINGS.SRI_SCRIPT_FAIL_DETAIL,
        STRINGS.SRI_SCRIPT_FAIL_REMEDIATION,
        STRINGS.SRI_SCRIPT_FAIL_URL
      );
    }

    return pass(STRINGS.SRI_SCRIPT_PASS_TITLE);
  })
  .add('security-sri-css', (payload, { pass, warn, skip }) => {
    const { links } = payload.page;
    const adyenLinks = links.filter((l: LinkTag) => isAdyenCheckoutResource(l.href));

    if (adyenLinks.length === 0) {
      return skip(STRINGS.SRI_CSS_SKIP_TITLE, STRINGS.SRI_CSS_SKIP_REASON);
    }

    const missing = adyenLinks.filter(hasMissingSriAttributes);
    if (missing.length > 0) {
      return warn(
        `${missing.length} Adyen stylesheet link(s) missing SRI attributes.`,
        STRINGS.SRI_CSS_WARN_DETAIL,
        STRINGS.SRI_CSS_WARN_REMEDIATION,
        STRINGS.SRI_CSS_WARN_URL
      );
    }
    return pass(STRINGS.SRI_CSS_PASS_TITLE);
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
        : STRINGS.REFERRER_POLICY_NOT_SET_NOTICE_TITLE,
      STRINGS.REFERRER_POLICY_NOTICE_DETAIL,
      STRINGS.REFERRER_POLICY_NOTICE_REMEDIATION,
      STRINGS.REFERRER_POLICY_NOTICE_URL
    );
  })
  .add('security-x-content-type', (payload, { pass, notice }) => {
    const value = getHeader(payload, 'X-Content-Type-Options');
    if (value?.toLowerCase() === 'nosniff') {
      return pass(STRINGS.XCTO_PASS_TITLE);
    }
    return notice(
      STRINGS.XCTO_NOTICE_TITLE,
      STRINGS.XCTO_NOTICE_DETAIL,
      STRINGS.XCTO_NOTICE_REMEDIATION,
      STRINGS.XCTO_NOTICE_URL
    );
  })
  .add('security-xss-protection', (payload, { pass, notice }) => {
    const value = getHeader(payload, 'X-XSS-Protection');
    if (value === null || value === '' || value === '0') {
      return pass(STRINGS.XSS_PASS_TITLE);
    }
    return notice(
      STRINGS.XSS_NOTICE_TITLE,
      STRINGS.XSS_NOTICE_DETAIL,
      STRINGS.XSS_NOTICE_REMEDIATION,
      STRINGS.XSS_NOTICE_URL
    );
  })
  .add('security-hsts', (payload, { pass, notice, skip }) => {
    if (resolveEnvironment(payload).env !== 'live') {
      return skip(STRINGS.HSTS_SKIP_TITLE, STRINGS.HSTS_SKIP_REASON);
    }
    const value = getHeader(payload, 'Strict-Transport-Security');
    if (value !== null && value !== '') return pass(STRINGS.HSTS_PASS_TITLE);
    return notice(
      STRINGS.HSTS_NOTICE_TITLE,
      STRINGS.HSTS_NOTICE_DETAIL,
      STRINGS.HSTS_NOTICE_REMEDIATION,
      STRINGS.HSTS_NOTICE_URL
    );
  })
  .add('security-iframe-referrerpolicy', (payload, { pass, info }) => {
    const { iframes } = payload.page;
    const adyenIframes = iframes.filter(
      (f: IframeInfo) =>
        f.src !== undefined && f.src !== '' && /\.(adyen\.com|adyenpayments\.com)/.test(f.src)
    );
    if (adyenIframes.length === 0) return info(STRINGS.IFRAME_RP_NO_ADYEN_INFO_TITLE);

    const missing = adyenIframes.filter(
      (f: IframeInfo) => f.referrerpolicy === undefined || f.referrerpolicy === ''
    );
    if (missing.length === 0) return pass(STRINGS.IFRAME_RP_PASS_TITLE);

    return info(STRINGS.IFRAME_RP_MISSING_INFO_TITLE, STRINGS.IFRAME_RP_MISSING_INFO_DETAIL);
  })
  .getChecks();
