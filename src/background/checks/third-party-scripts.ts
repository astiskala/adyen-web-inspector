/**
 * Third-party script checks (`third-party`) — tag managers, session replay, ad pixels, script
 * integrity, and Cookiebot blocking.
 */

import type { ScanPayload } from '../../shared/types.js';
import {
  AD_PIXEL_PATTERNS,
  ANALYTICS_PATTERNS,
  SESSION_REPLAY_PATTERNS,
  TAG_MANAGER_PATTERNS,
} from '../../shared/constants.js';
import { extractHostname } from '../../shared/utils.js';
import { COMMON_DETAILS } from './constants.js';
import { createRegistry, type CheckContext, type CheckOutcome } from './registry.js';

const CATEGORY = 'third-party' as const;
const ADYEN_PCI_SCRIPT_SECURITY_DOC =
  'https://docs.adyen.com/development-resources/pci-dss-compliance-guide/script-security#scripts-integrity';
const THIRD_PARTY_SCRIPT_PATTERNS = [
  ...TAG_MANAGER_PATTERNS,
  ...ANALYTICS_PATTERNS,
  ...SESSION_REPLAY_PATTERNS,
  ...AD_PIXEL_PATTERNS,
] as const;

const STRINGS = {
  TAG_MANAGER_DETECTED_PREFIX: 'Tag manager(s) detected',
  TAG_MANAGER_DETAIL:
    'Tag managers can dynamically load unreviewed scripts on the payment page, bypassing the script inventory and authorization required by PCI DSS requirement 6.4.3.',
  TAG_MANAGER_REMEDIATION:
    'Audit all tags loaded via tag managers on payment pages. Ensure every script loaded through the tag manager is included in your script inventory with a written justification.',
  TAG_MANAGER_PASS_TITLE: 'No known tag managers detected.',

  SESSION_REPLAY_DETECTED_PREFIX: 'Session replay tool detected',
  SESSION_REPLAY_DETAIL:
    'Session replay tools record DOM state including payment form fields, risking exposure of sensitive payment data. All scripts on the payment page must be inventoried and authorized per PCI DSS requirement 6.4.3.',
  SESSION_REPLAY_REMEDIATION:
    'Remove session replay and screen recording tools from payment pages. If retention is justified, ensure the tool is included in your script inventory, integrity-checked with SRI, and configured to exclude payment form fields.',
  SESSION_REPLAY_PASS_TITLE: 'No known session replay tools detected.',

  AD_PIXELS_DETECTED_PREFIX: 'Ad pixel(s) detected',
  AD_PIXELS_DETAIL:
    'Ad pixels on payment pages add scripts that must be inventoried and authorized per PCI DSS requirement 6.4.3. They can expose payment journey metadata to third-party advertising networks.',
  AD_PIXELS_REMEDIATION:
    'Move advertising and conversion tracking pixels to the post-payment order confirmation page. If they must remain on the payment page, ensure each pixel is included in your script inventory with a written justification.',
  AD_PIXELS_PASS_TITLE: 'No known ad pixels detected.',

  NO_SRI_NONE_PASS_TITLE: 'No known third-party scripts detected requiring SRI.',
  NO_SRI_PASS_TITLE: 'Detected third-party scripts have SRI.',
  // NO_SRI_NOTICE_TITLE stays inline (dynamic: uses withoutSri.length)
  NO_SRI_NOTICE_DETAIL: `Without Subresource Integrity (SRI), third-party scripts can be altered by upstream compromises without browser detection. PCI DSS requirement 6.4.3 requires a method to assure the integrity of each script on the payment page. ${COMMON_DETAILS.PCI_COMPLIANCE_NOTICE}`,
  NO_SRI_NOTICE_REMEDIATION:
    'Add integrity and crossorigin attributes to each third-party script tag on the payment page.',

  COOKIEBOT_SKIP_TITLE: 'Cookiebot card-field check skipped.',
  COOKIEBOT_SKIP_REASON: 'No mounted Card or Drop-in detected.',
  COOKIEBOT_PASS_TITLE: 'No Cookiebot auto-blocking script tag detected.',
  COOKIEBOT_WARN_TITLE: 'Cookiebot automatic blocking may prevent Adyen card fields from loading.',
  COOKIEBOT_WARN_DETAIL:
    'Automatic blocking can prevent card fields inside Adyen-managed iframes from loading until the shopper gives consent.',
  COOKIEBOT_WARN_REMEDIATION:
    'Remove data-blockingmode="auto" from the Cookiebot script tag on the checkout page so the card fields can load regardless of cookie consent.',
  COOKIEBOT_WARN_URL:
    'https://docs.adyen.com/online-payments/web-best-practices/#prevent-cookiebot-from-blocking-card-fields',
} as const;

type ThirdPartyPattern = Readonly<{ name: string; pattern: RegExp }>;

interface PatternCheckOptions {
  readonly patterns: readonly ThirdPartyPattern[];
  readonly detectedTitlePrefix: string;
  readonly detectionSeverity: 'notice' | 'warn';
  readonly detail?: string;
  readonly remediation: string;
  readonly docsUrl: string;
  readonly passTitle: string;
}

function getScriptSources(payload: ScanPayload): string[] {
  return payload.page.scripts.map((script) => script.src);
}

function findMatchingScripts(srcs: string[], patterns: readonly ThirdPartyPattern[]): string[] {
  const matches: string[] = [];
  for (const { name, pattern } of patterns) {
    if (srcs.some((src) => pattern.test(src))) {
      matches.push(name);
    }
  }
  return matches;
}

function scriptMatchesAnyPattern(src: string, patterns: readonly ThirdPartyPattern[]): boolean {
  return patterns.some(({ pattern }) => pattern.test(src));
}

function runPatternCheck(
  payload: ScanPayload,
  options: PatternCheckOptions,
  context: CheckContext
): CheckOutcome {
  const found = findMatchingScripts(getScriptSources(payload), options.patterns);
  if (found.length === 0) {
    return context.pass(options.passTitle);
  }

  const title = `${options.detectedTitlePrefix}: ${found.join(', ')}.`;
  if (options.detectionSeverity === 'warn') {
    return context.warn(title, options.detail, options.remediation, options.docsUrl);
  }
  return context.notice(title, options.detail, options.remediation, options.docsUrl);
}

export const THIRD_PARTY_CHECKS = createRegistry(CATEGORY)
  .add('3p-tag-manager', (payload, context) =>
    runPatternCheck(
      payload,
      {
        patterns: TAG_MANAGER_PATTERNS,
        detectedTitlePrefix: STRINGS.TAG_MANAGER_DETECTED_PREFIX,
        detectionSeverity: 'notice',
        detail: STRINGS.TAG_MANAGER_DETAIL,
        remediation: STRINGS.TAG_MANAGER_REMEDIATION,
        docsUrl: ADYEN_PCI_SCRIPT_SECURITY_DOC,
        passTitle: STRINGS.TAG_MANAGER_PASS_TITLE,
      },
      context
    )
  )
  .add('3p-session-replay', (payload, context) =>
    runPatternCheck(
      payload,
      {
        patterns: SESSION_REPLAY_PATTERNS,
        detectedTitlePrefix: STRINGS.SESSION_REPLAY_DETECTED_PREFIX,
        detectionSeverity: 'warn',
        detail: STRINGS.SESSION_REPLAY_DETAIL,
        remediation: STRINGS.SESSION_REPLAY_REMEDIATION,
        docsUrl: ADYEN_PCI_SCRIPT_SECURITY_DOC,
        passTitle: STRINGS.SESSION_REPLAY_PASS_TITLE,
      },
      context
    )
  )
  .add('3p-ad-pixels', (payload, context) =>
    runPatternCheck(
      payload,
      {
        patterns: AD_PIXEL_PATTERNS,
        detectedTitlePrefix: STRINGS.AD_PIXELS_DETECTED_PREFIX,
        detectionSeverity: 'warn',
        detail: STRINGS.AD_PIXELS_DETAIL,
        remediation: STRINGS.AD_PIXELS_REMEDIATION,
        docsUrl: ADYEN_PCI_SCRIPT_SECURITY_DOC,
        passTitle: STRINGS.AD_PIXELS_PASS_TITLE,
      },
      context
    )
  )
  .add('3p-no-sri', (payload, { pass, notice }) => {
    const knownThirdPartyScripts = payload.page.scripts.filter(
      (s) => s.src.startsWith('http') && scriptMatchesAnyPattern(s.src, THIRD_PARTY_SCRIPT_PATTERNS)
    );

    if (knownThirdPartyScripts.length === 0) {
      return pass(STRINGS.NO_SRI_NONE_PASS_TITLE);
    }

    const withoutSri = knownThirdPartyScripts.filter(
      (s) => s.integrity === undefined || s.integrity === ''
    );
    if (withoutSri.length === 0) {
      return pass(STRINGS.NO_SRI_PASS_TITLE);
    }

    return notice(
      `${withoutSri.length} third-party script(s) loaded without SRI.`,
      STRINGS.NO_SRI_NOTICE_DETAIL,
      STRINGS.NO_SRI_NOTICE_REMEDIATION,
      ADYEN_PCI_SCRIPT_SECURITY_DOC
    );
  })
  .add('3p-cookiebot-auto-blocking', (payload, { skip, pass, warn }) => {
    const { page } = payload;
    if (page.hasCardDOM !== true && page.hasDropinDOM !== true) {
      return skip(STRINGS.COOKIEBOT_SKIP_TITLE, STRINGS.COOKIEBOT_SKIP_REASON);
    }

    const isAutoBlocking = page.scripts.some(
      (script) =>
        script.blockingMode?.trim().toLowerCase() === 'auto' &&
        extractHostname(script.src) === 'consent.cookiebot.com'
    );
    if (!isAutoBlocking) return pass(STRINGS.COOKIEBOT_PASS_TITLE);

    return warn(
      STRINGS.COOKIEBOT_WARN_TITLE,
      STRINGS.COOKIEBOT_WARN_DETAIL,
      STRINGS.COOKIEBOT_WARN_REMEDIATION,
      STRINGS.COOKIEBOT_WARN_URL
    );
  })
  .getChecks();
