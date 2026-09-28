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
import { readCheckoutField } from '../../shared/scan-evidence.js';
import { getHeader, isAdyenCheckoutResource } from '../../shared/utils.js';
import { COMMON_DETAILS, SKIP_REASONS } from './constants.js';
import { readPagePolicy, type PagePolicy } from './page-policy.js';
import { createRegistry, type CheckContext } from './registry.js';

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

type EnforcedPolicy = Extract<PagePolicy, { status: 'enforced' }>;
type CheckOutcome = ReturnType<CheckContext['skip']>;

/** Skips a directive check when headers are unavailable or no policy is set. */
function skipUnenforced(
  policy: Exclude<PagePolicy, EnforcedPolicy>,
  title: string,
  { skip }: CheckContext
): CheckOutcome {
  return policy.status === 'unavailable'
    ? skip(title, SKIP_REASONS.HEADERS_UNAVAILABLE)
    : skip(title, STRINGS.NO_CSP_SKIP_REASON);
}

function isAdyenWebEnvironment(name: string): name is keyof typeof ADYEN_WEB_ENVIRONMENT_URLS {
  return Object.hasOwn(ADYEN_WEB_ENVIRONMENT_URLS, name);
}

/**
 * Mirrors Adyen Web v6 environment URL resolution: names are lowercased and
 * unknown environment names fall back to the default live endpoints.
 */
function resolveAdyenWebUrls(payload: ScanPayload): AdyenWebEnvironmentOrigins | null {
  const environment = readCheckoutField(payload, 'environment');
  if (environment.state === 'present') {
    const name = environment.value.toLowerCase();
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
  const locale = readCheckoutField(payload, 'locale');
  if (locale.state !== 'present') return false;
  const language = locale.value.slice(0, 2).toLowerCase();
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
  policy: EnforcedPolicy,
  directive: 'connect-src' | 'img-src',
  required: readonly RequiredCspUrl[]
): RequiredCspUrl[] {
  return required.filter(({ url }) => !policy.allows(directive, url));
}

export const CSP_CHECKS = createRegistry(CATEGORY)
  .add('security-csp-present', (payload, { pass, warn, skip }) => {
    const policy = readPagePolicy(payload);
    if (policy.status === 'unavailable') {
      return skip('CSP presence check skipped.', SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    if (policy.status === 'enforced') {
      return pass(STRINGS.CSP_PRESENT_PASS_TITLE);
    }
    return warn(
      STRINGS.CSP_PRESENT_WARN_TITLE,
      STRINGS.CSP_PRESENT_WARN_DETAIL,
      STRINGS.CSP_PRESENT_WARN_REMEDIATION,
      STRINGS.CSP_PRESENT_WARN_URL
    );
  })
  .add('security-csp-script-src', (payload, context) => {
    const { skip, pass, warn } = context;
    const policy = readPagePolicy(payload);
    if (policy.status !== 'enforced') {
      return skipUnenforced(policy, STRINGS.SCRIPT_SRC_SKIP_TITLE, context);
    }

    const adyenScripts = payload.page.scripts.filter((script) =>
      isAdyenCheckoutResource(script.src)
    );
    if (adyenScripts.length === 0) {
      return skip(STRINGS.SCRIPT_SRC_SKIP_TITLE, 'No Adyen-hosted checkout scripts detected.');
    }

    if (adyenScripts.every((script) => policy.allows('script-src', script.src))) {
      return pass(STRINGS.SCRIPT_SRC_PASS_TITLE);
    }

    return warn(
      STRINGS.SCRIPT_SRC_WARN_TITLE,
      STRINGS.SCRIPT_SRC_WARN_DETAIL,
      STRINGS.SCRIPT_SRC_WARN_REMEDIATION,
      STRINGS.SCRIPT_SRC_WARN_URL
    );
  })
  .add('security-csp-frame-src', (payload, context) => {
    const { warn, pass } = context;
    const policy = readPagePolicy(payload);
    if (policy.status !== 'enforced') {
      return skipUnenforced(policy, STRINGS.FRAME_SRC_SKIP_TITLE, context);
    }

    const restrictive = policy.restrictive('frame-src');
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
      policy
        .governing('frame-src')
        .some((governing) => governing === null || governing.directive === 'default-src')
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
  .add('security-csp-connect-src', (payload, context) => {
    const { skip, pass, warn } = context;
    const policy = readPagePolicy(payload);
    if (policy.status !== 'enforced') {
      return skipUnenforced(policy, STRINGS.CONNECT_SRC_SKIP_TITLE, context);
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
    const blocked = findBlockedUrls(policy, 'connect-src', required);
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
    (payload, context) => {
      const { skip, pass, warn } = context;
      const policy = readPagePolicy(payload);
      if (policy.status !== 'enforced') {
        return skipUnenforced(policy, STRINGS.IMG_SRC_SKIP_TITLE, context);
      }
      const urls = resolveAdyenWebUrls(payload);
      if (urls === null) {
        return skip(STRINGS.IMG_SRC_SKIP_TITLE, STRINGS.NO_ENV_SKIP_REASON);
      }

      const required = [{ url: `${urls.cdn}images/logos/card.svg`, purpose: 'logos' }];
      const blocked = findBlockedUrls(policy, 'img-src', required);
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
  .add('security-csp-form-action', (payload, context) => {
    const { pass, warn } = context;
    const policy = readPagePolicy(payload);
    if (policy.status !== 'enforced') {
      return skipUnenforced(policy, STRINGS.FORM_ACTION_SKIP_TITLE, context);
    }

    if (policy.restrictive('form-action') !== undefined) {
      return warn(
        STRINGS.FORM_ACTION_WARN_TITLE,
        STRINGS.FORM_ACTION_WARN_DETAIL,
        STRINGS.FORM_ACTION_WARN_REMEDIATION,
        ADYEN_PCI_DSS_EXTERNAL_SOURCES_DOC
      );
    }
    if (policy.governing('form-action').every((governing) => governing === null)) {
      return pass(STRINGS.FORM_ACTION_UNSET_PASS_TITLE);
    }
    return pass(STRINGS.FORM_ACTION_PASS_TITLE);
  })
  .add('security-csp-frame-ancestors', (payload, { pass, warn, skip }) => {
    const policy = readPagePolicy(payload);
    if (policy.status === 'unavailable') {
      return skip('CSP frame-ancestors check skipped.', SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    const hasFrameAncestors = policy.status === 'enforced' && policy.declares('frame-ancestors');
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
    const policy = readPagePolicy(payload);
    if (policy.status === 'unavailable') {
      return skip('CSP reporting check skipped.', SKIP_REASONS.HEADERS_UNAVAILABLE);
    }
    const reportingEndpoints = getHeader(payload, 'reporting-endpoints');

    if (policy.status === 'absent') {
      return info(STRINGS.REPORTING_SKIP_INFO_TITLE);
    }

    const hasReportTo = policy.declares('report-to');
    const hasReportUri = policy.declares('report-uri');

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
