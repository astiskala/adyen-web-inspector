/**
 * Security: CSP checks.
 */

import type { ScanPayload } from '../../shared/types.js';
import {
  ADYEN_WEB_ENVIRONMENT_URLS,
  ADYEN_WEB_TRANSLATION_LOCALES,
  type AdyenWebEnvironmentOrigins,
} from '../../shared/constants.js';
import { resolveEnvironment } from '../../shared/implementation-attributes.js';
import { observeCheckoutField } from '../../shared/scan-evidence.js';
import {
  cspAllowsUrl,
  getAllHeaders,
  getEffectiveCspSources,
  getHeader,
  isAdyenCheckoutResource,
  parseCsp,
} from '../../shared/utils.js';
import { COMMON_DETAILS, SKIP_REASONS } from './constants.js';
import { createRegistry } from './registry.js';

const CATEGORY = 'security' as const;
const ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC =
  'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/script-security#implement-a-content-security-policy-for-requirement-6-4-3';
const ADYEN_PCI_DSS_EXTERNAL_SOURCES_DOC =
  'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/script-security#allow-external-sources';
const ADYEN_PCI_DSS_REPORTING_DOC =
  'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/script-security#report';

const STRINGS = {
  NO_CSP_SKIP_REASON: 'No Content-Security-Policy header present.',
  NO_ENV_SKIP_REASON: 'The Adyen Web environment could not be determined.',

  CSP_PRESENT_PASS_TITLE: 'Content-Security-Policy header is present.',
  CSP_PRESENT_WARN_TITLE: 'Content-Security-Policy header is missing.',
  CSP_PRESENT_WARN_DETAIL: `A CSP helps prevent XSS and data injection attacks on checkout pages. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  CSP_PRESENT_WARN_REMEDIATION:
    'Add a Content-Security-Policy header to your checkout page HTTP response.',
  CSP_PRESENT_WARN_URL: ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC,

  SCRIPT_SRC_SKIP_TITLE: 'CSP script-src check skipped.',
  SCRIPT_SRC_PASS_TITLE: 'CSP allows the observed Adyen checkout scripts.',
  SCRIPT_SRC_WARN_TITLE: 'CSP may block an observed Adyen checkout script.',
  SCRIPT_SRC_WARN_DETAIL: `If script-src omits Adyen domains, checkout assets can be blocked or require unsafe CSP relaxations. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  SCRIPT_SRC_WARN_REMEDIATION:
    'Update your Content-Security-Policy to include the Adyen CDN script domains.',
  SCRIPT_SRC_WARN_URL: ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC,

  FRAME_SRC_SKIP_TITLE: 'CSP frame-src check skipped.',
  FRAME_SRC_PASS_TITLE: 'CSP frame-src is compatible with Adyen 3DS iframe guidance.',
  FRAME_SRC_MISSING_WARN_TITLE: 'CSP frame-src/child-src is not explicitly set.',
  FRAME_SRC_MISSING_WARN_DETAIL: `Without an explicit frame-src policy, iframes follow default-src (or are unrestricted), which Adyen describes as functional but not stable for 3DS issuer iframes. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  FRAME_SRC_MISSING_WARN_REMEDIATION:
    'Add an explicit frame-src directive to your Content-Security-Policy. Adyen recommends frame-src * so issuer 3DS iframes can load.',
  FRAME_SRC_MISSING_WARN_URL: ADYEN_PCI_DSS_EXTERNAL_SOURCES_DOC,
  FRAME_SRC_STRICT_WARN_TITLE: 'CSP frame-src may be too restrictive for 3DS issuer iframes.',
  FRAME_SRC_STRICT_WARN_DETAIL: `Overly restrictive frame-src rules can block issuer challenge frames and break 3DS authentication. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  FRAME_SRC_INHERITED_STRICT_WARN_DETAIL: `No frame-src or child-src is set, so iframes inherit a default-src that does not allow HTTPS issuer pages. This can block issuer challenge frames and break 3DS authentication. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  FRAME_SRC_STRICT_WARN_REMEDIATION:
    'Set frame-src to allow HTTPS iframe sources. Adyen recommends frame-src * because issuer 3DS domains cannot be listed in advance.',
  FRAME_SRC_STRICT_WARN_URL: ADYEN_PCI_DSS_EXTERNAL_SOURCES_DOC,

  CONNECT_SRC_SKIP_TITLE: 'CSP connect-src check skipped.',
  CONNECT_SRC_PASS_TITLE: 'CSP connect-src allows the Adyen Web endpoints for this environment.',
  CONNECT_SRC_WARN_TITLE: 'CSP connect-src may block Adyen Web requests.',
  CONNECT_SRC_WARN_REMEDIATION:
    'Allow the listed Adyen origins in connect-src (or default-src when connect-src is not set). Adyen recommends connect-src * because some payment methods also call their own domains.',

  IMG_SRC_SKIP_TITLE: 'CSP img-src check skipped.',
  IMG_SRC_PASS_TITLE: 'CSP img-src allows Adyen payment method logos.',
  IMG_SRC_WARN_TITLE: 'CSP img-src may block Adyen payment method logos.',
  IMG_SRC_WARN_REMEDIATION:
    'Allow the Adyen CDN origin in img-src (or default-src when img-src is not set). Adyen recommends img-src *.',

  FORM_ACTION_SKIP_TITLE: 'CSP form-action check skipped.',
  FORM_ACTION_PASS_TITLE: 'CSP form-action allows 3DS and redirect form submissions.',
  FORM_ACTION_UNSET_PASS_TITLE: 'CSP does not restrict form-action.',
  FORM_ACTION_WARN_TITLE: 'CSP form-action may block 3DS and redirect payment forms.',
  FORM_ACTION_WARN_DETAIL:
    'Adyen Web posts hidden forms to issuer and payment method URLs for 3DS authentication and POST redirects. A form-action that does not allow HTTPS destinations blocks these submissions. form-action does not fall back to default-src.',
  FORM_ACTION_WARN_REMEDIATION:
    'Set form-action to allow HTTPS destinations. Adyen recommends form-action *.',

  FRAME_ANCESTORS_CSP_PASS_TITLE: 'CSP frame-ancestors directive is set.',
  FRAME_ANCESTORS_XFO_PASS_TITLE: 'X-Frame-Options header is present.',
  FRAME_ANCESTORS_WARN_TITLE: 'No frame-ancestors CSP directive or X-Frame-Options header found.',
  FRAME_ANCESTORS_WARN_DETAIL: `Without anti-framing protection, checkout can be embedded and abused in clickjacking attacks. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  FRAME_ANCESTORS_WARN_REMEDIATION:
    'Add a frame-ancestors directive to your Content-Security-Policy or set an X-Frame-Options: SAMEORIGIN header.',
  FRAME_ANCESTORS_WARN_URL: ADYEN_PCI_DSS_SCRIPT_SECURITY_DOC,

  REPORTING_SKIP_INFO_TITLE: 'CSP reporting check skipped. No CSP header present.',
  REPORTING_PASS_TITLE: 'CSP reporting is configured with report-to and Reporting-Endpoints.',
  REPORTING_NO_ENDPOINTS_WARN_TITLE:
    'CSP has report-to, but Reporting-Endpoints header is missing.',
  REPORTING_NO_ENDPOINTS_WARN_DETAIL:
    'Without a reporting endpoint, CSP violations are not captured for investigation.',
  REPORTING_NO_ENDPOINTS_WARN_REMEDIATION:
    'Add a Reporting-Endpoints response header that maps your report-to endpoint name.',
  REPORTING_NO_ENDPOINTS_WARN_URL: ADYEN_PCI_DSS_REPORTING_DOC,
  REPORTING_REPORT_URI_INFO_TITLE: 'CSP report-uri is configured, but report-to is recommended.',
  REPORTING_REPORT_URI_INFO_DETAIL: `Migrate from the older report-uri directive to report-to. See: ${ADYEN_PCI_DSS_REPORTING_DOC}`,
  REPORTING_NONE_INFO_TITLE: 'CSP reporting is not configured.',
  REPORTING_NONE_INFO_DETAIL: `Configure CSP violation reporting by adding the report-to directive. See: ${ADYEN_PCI_DSS_REPORTING_DOC}`,
} as const;

function getCspPolicies(payload: ScanPayload): ReturnType<typeof parseCsp>[] {
  return getAllHeaders(payload, 'content-security-policy')
    .flatMap((value) => value.split(/\s*,\s*/))
    .filter((value) => value.trim() !== '')
    .map(parseCsp);
}

function allowsAnySources(values: readonly string[]): boolean {
  return values.includes('*') || values.includes('https:');
}

type EffectiveSources = NonNullable<ReturnType<typeof getEffectiveCspSources>>;

function isRestrictiveSources(effective: EffectiveSources | null): effective is EffectiveSources {
  return effective !== null && !allowsAnySources(effective.sources);
}

function isAdyenWebEnvironment(name: string): name is keyof typeof ADYEN_WEB_ENVIRONMENT_URLS {
  return Object.hasOwn(ADYEN_WEB_ENVIRONMENT_URLS, name);
}

/**
 * Mirrors Adyen Web v6 environment URL resolution: names are lowercased and
 * unknown environment names fall back to the default live endpoints.
 */
function resolveAdyenWebUrls(payload: ScanPayload): AdyenWebEnvironmentOrigins | null {
  const { value: environment } = observeCheckoutField(payload, 'environment');
  if (environment !== undefined) {
    const name = environment.toLowerCase();
    return isAdyenWebEnvironment(name)
      ? ADYEN_WEB_ENVIRONMENT_URLS[name]
      : ADYEN_WEB_ENVIRONMENT_URLS.live;
  }
  if (resolveEnvironment(payload).env === 'test') {
    return ADYEN_WEB_ENVIRONMENT_URLS.test;
  }
  return null;
}

const CDN_TRANSLATION_LANGUAGES = new Set(
  ADYEN_WEB_TRANSLATION_LOCALES.map((locale) => locale.slice(0, 2).toLowerCase())
);

/** Adyen Web bundles en-US and fetches other supported translations from the CDN. */
function fetchesCdnTranslations(payload: ScanPayload): boolean {
  const { value: locale } = observeCheckoutField(payload, 'locale');
  if (locale === undefined) return false;
  const language = locale.slice(0, 2).toLowerCase();
  return language !== 'en' && CDN_TRANSLATION_LANGUAGES.has(language);
}

interface RequiredCspUrl {
  readonly url: string;
  readonly purpose: string;
}

function describeBlockedUrls(blocked: readonly RequiredCspUrl[]): string {
  return blocked.map(({ url, purpose }) => `${new URL(url).origin} (${purpose})`).join(', ');
}

function findBlockedUrls(
  payload: ScanPayload,
  policies: ReturnType<typeof getCspPolicies>,
  directive: 'connect-src' | 'img-src',
  required: readonly RequiredCspUrl[]
): RequiredCspUrl[] {
  return required.filter(({ url }) =>
    policies.some((policy) => !cspAllowsUrl(policy, directive, url, payload.pageUrl))
  );
}

export const CSP_CHECKS = createRegistry(CATEGORY)
  .add('security-csp-present', (payload, { pass, warn, skip }) => {
    if (!payload.mainDocumentHeadersAvailable) {
      return skip('CSP presence check skipped.', SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    if (getCspPolicies(payload).length > 0) {
      return pass(STRINGS.CSP_PRESENT_PASS_TITLE);
    }
    return warn(
      STRINGS.CSP_PRESENT_WARN_TITLE,
      STRINGS.CSP_PRESENT_WARN_DETAIL,
      STRINGS.CSP_PRESENT_WARN_REMEDIATION,
      STRINGS.CSP_PRESENT_WARN_URL
    );
  })
  .add('security-csp-script-src', (payload, { skip, pass, warn }) => {
    if (!payload.mainDocumentHeadersAvailable) {
      return skip(STRINGS.SCRIPT_SRC_SKIP_TITLE, SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    const policies = getCspPolicies(payload);
    if (policies.length === 0) {
      return skip(STRINGS.SCRIPT_SRC_SKIP_TITLE, STRINGS.NO_CSP_SKIP_REASON);
    }

    const adyenScripts = payload.page.scripts.filter((script) =>
      isAdyenCheckoutResource(script.src)
    );
    if (adyenScripts.length === 0) {
      return skip(STRINGS.SCRIPT_SRC_SKIP_TITLE, 'No Adyen-hosted checkout scripts detected.');
    }

    const allAllowed = policies.every((policy) =>
      adyenScripts.every((script) =>
        cspAllowsUrl(policy, 'script-src', script.src, payload.pageUrl)
      )
    );
    if (allAllowed) return pass(STRINGS.SCRIPT_SRC_PASS_TITLE);

    return warn(
      STRINGS.SCRIPT_SRC_WARN_TITLE,
      STRINGS.SCRIPT_SRC_WARN_DETAIL,
      STRINGS.SCRIPT_SRC_WARN_REMEDIATION,
      STRINGS.SCRIPT_SRC_WARN_URL
    );
  })
  .add('security-csp-frame-src', (payload, { skip, warn, pass }) => {
    if (!payload.mainDocumentHeadersAvailable) {
      return skip(STRINGS.FRAME_SRC_SKIP_TITLE, SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    const policies = getCspPolicies(payload);
    if (policies.length === 0) {
      return skip(STRINGS.FRAME_SRC_SKIP_TITLE, STRINGS.NO_CSP_SKIP_REASON);
    }

    const effectiveSources = policies.map((policy) => getEffectiveCspSources(policy, 'frame-src'));
    const restrictive = effectiveSources.find(isRestrictiveSources);
    if (restrictive !== undefined) {
      return warn(
        STRINGS.FRAME_SRC_STRICT_WARN_TITLE,
        restrictive.directive === 'default-src'
          ? STRINGS.FRAME_SRC_INHERITED_STRICT_WARN_DETAIL
          : STRINGS.FRAME_SRC_STRICT_WARN_DETAIL,
        STRINGS.FRAME_SRC_STRICT_WARN_REMEDIATION,
        STRINGS.FRAME_SRC_STRICT_WARN_URL
      );
    }

    if (
      effectiveSources.some(
        (effective) => effective === null || effective.directive === 'default-src'
      )
    ) {
      return warn(
        STRINGS.FRAME_SRC_MISSING_WARN_TITLE,
        STRINGS.FRAME_SRC_MISSING_WARN_DETAIL,
        STRINGS.FRAME_SRC_MISSING_WARN_REMEDIATION,
        STRINGS.FRAME_SRC_MISSING_WARN_URL
      );
    }

    return pass(STRINGS.FRAME_SRC_PASS_TITLE);
  })
  .add('security-csp-connect-src', (payload, { skip, pass, warn }) => {
    if (!payload.mainDocumentHeadersAvailable) {
      return skip(STRINGS.CONNECT_SRC_SKIP_TITLE, SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    const policies = getCspPolicies(payload);
    if (policies.length === 0) {
      return skip(STRINGS.CONNECT_SRC_SKIP_TITLE, STRINGS.NO_CSP_SKIP_REASON);
    }
    const urls = resolveAdyenWebUrls(payload);
    if (urls === null) {
      return skip(STRINGS.CONNECT_SRC_SKIP_TITLE, STRINGS.NO_ENV_SKIP_REASON);
    }

    const required: RequiredCspUrl[] = [
      { url: `${urls.api}v1/`, purpose: 'checkout API' },
      { url: `${urls.analytics}v3/analytics`, purpose: 'checkout analytics' },
      ...(fetchesCdnTranslations(payload)
        ? [{ url: `${urls.cdn}sdk/`, purpose: 'translations' }]
        : []),
    ];
    const blocked = findBlockedUrls(payload, policies, 'connect-src', required);
    if (blocked.length === 0) return pass(STRINGS.CONNECT_SRC_PASS_TITLE);

    return warn(
      STRINGS.CONNECT_SRC_WARN_TITLE,
      `The policy does not allow ${describeBlockedUrls(blocked)}. Adyen Web calls these origins for Sessions, card BIN lookups, checkout attempt IDs, and localized text.`,
      STRINGS.CONNECT_SRC_WARN_REMEDIATION,
      ADYEN_PCI_DSS_EXTERNAL_SOURCES_DOC
    );
  })
  .add(
    'security-csp-img-src',
    (payload, { skip, pass, warn }) => {
      if (!payload.mainDocumentHeadersAvailable) {
        return skip(STRINGS.IMG_SRC_SKIP_TITLE, SKIP_REASONS.HEADERS_UNAVAILABLE);
      }
      const policies = getCspPolicies(payload);
      if (policies.length === 0) {
        return skip(STRINGS.IMG_SRC_SKIP_TITLE, STRINGS.NO_CSP_SKIP_REASON);
      }
      const urls = resolveAdyenWebUrls(payload);
      if (urls === null) {
        return skip(STRINGS.IMG_SRC_SKIP_TITLE, STRINGS.NO_ENV_SKIP_REASON);
      }

      const required = [{ url: `${urls.cdn}images/logos/card.svg`, purpose: 'logos' }];
      const blocked = findBlockedUrls(payload, policies, 'img-src', required);
      if (blocked.length === 0) return pass(STRINGS.IMG_SRC_PASS_TITLE);

      return warn(
        STRINGS.IMG_SRC_WARN_TITLE,
        `The policy does not allow ${describeBlockedUrls(blocked)}. Adyen Web loads payment method and card brand logos from this origin, so blocked images leave empty icons in checkout.`,
        STRINGS.IMG_SRC_WARN_REMEDIATION,
        ADYEN_PCI_DSS_EXTERNAL_SOURCES_DOC
      );
    },
    { warnImpact: 'low' }
  )
  .add('security-csp-form-action', (payload, { skip, pass, warn }) => {
    if (!payload.mainDocumentHeadersAvailable) {
      return skip(STRINGS.FORM_ACTION_SKIP_TITLE, SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    const policies = getCspPolicies(payload);
    if (policies.length === 0) {
      return skip(STRINGS.FORM_ACTION_SKIP_TITLE, STRINGS.NO_CSP_SKIP_REASON);
    }

    const effectiveSources = policies.map((policy) =>
      getEffectiveCspSources(policy, 'form-action')
    );
    if (effectiveSources.some(isRestrictiveSources)) {
      return warn(
        STRINGS.FORM_ACTION_WARN_TITLE,
        STRINGS.FORM_ACTION_WARN_DETAIL,
        STRINGS.FORM_ACTION_WARN_REMEDIATION,
        ADYEN_PCI_DSS_EXTERNAL_SOURCES_DOC
      );
    }
    if (effectiveSources.every((effective) => effective === null)) {
      return pass(STRINGS.FORM_ACTION_UNSET_PASS_TITLE);
    }
    return pass(STRINGS.FORM_ACTION_PASS_TITLE);
  })
  .add('security-csp-frame-ancestors', (payload, { pass, warn, skip }) => {
    if (!payload.mainDocumentHeadersAvailable) {
      return skip('CSP frame-ancestors check skipped.', SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    const hasFrameAncestors = getCspPolicies(payload).some(
      (policy) => policy.directives['frame-ancestors'] !== undefined
    );
    const hasXfo = getHeader(payload, 'x-frame-options') !== null;

    if (hasFrameAncestors || hasXfo) {
      return pass(
        hasFrameAncestors
          ? STRINGS.FRAME_ANCESTORS_CSP_PASS_TITLE
          : STRINGS.FRAME_ANCESTORS_XFO_PASS_TITLE
      );
    }

    return warn(
      STRINGS.FRAME_ANCESTORS_WARN_TITLE,
      STRINGS.FRAME_ANCESTORS_WARN_DETAIL,
      STRINGS.FRAME_ANCESTORS_WARN_REMEDIATION,
      STRINGS.FRAME_ANCESTORS_WARN_URL
    );
  })
  .add('security-csp-reporting', (payload, { info, pass, warn, skip }) => {
    if (!payload.mainDocumentHeadersAvailable) {
      return skip('CSP reporting check skipped.', SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    const policies = getCspPolicies(payload);
    const reportingEndpoints = getHeader(payload, 'reporting-endpoints');

    if (policies.length === 0) {
      return info(STRINGS.REPORTING_SKIP_INFO_TITLE);
    }

    const hasReportTo = policies.some((policy) => policy.directives['report-to'] !== undefined);
    const hasReportUri = policies.some((policy) => policy.directives['report-uri'] !== undefined);

    if (hasReportTo && Boolean(reportingEndpoints)) {
      return pass(STRINGS.REPORTING_PASS_TITLE);
    }

    if (hasReportTo) {
      return warn(
        STRINGS.REPORTING_NO_ENDPOINTS_WARN_TITLE,
        STRINGS.REPORTING_NO_ENDPOINTS_WARN_DETAIL,
        STRINGS.REPORTING_NO_ENDPOINTS_WARN_REMEDIATION,
        STRINGS.REPORTING_NO_ENDPOINTS_WARN_URL
      );
    }

    if (hasReportUri) {
      return info(
        STRINGS.REPORTING_REPORT_URI_INFO_TITLE,
        STRINGS.REPORTING_REPORT_URI_INFO_DETAIL
      );
    }

    return info(STRINGS.REPORTING_NONE_INFO_TITLE, STRINGS.REPORTING_NONE_INFO_DETAIL);
  })
  .getChecks();
