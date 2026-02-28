import { ADYEN_WEB_TRANSLATION_LOCALES, ORIGIN_KEY_PREFIX } from '../../shared/constants.js';
import { detectIntegrationFlow } from '../../shared/implementation-attributes.js';
import { SKIP_REASONS } from './constants.js';
import { createRegistry } from './registry.js';

const STRINGS = {
  CLIENT_KEY_SKIP_TITLE: 'Client key check skipped.',
  CLIENT_KEY_SKIP_REASON: 'Client key not detected.',
  CLIENT_KEY_PASS_TITLE: 'Client key (not an origin key) is in use.',
  CLIENT_KEY_WARN_TITLE: 'Origin key detected — migrate to a client key.',
  // CLIENT_KEY_WARN_DETAIL stays inline (dynamic: uses clientKey.slice(0, 12))
  CLIENT_KEY_WARN_REMEDIATION:
    'Generate a client key in the Adyen Customer Area (Developers → API credentials → Client-side integration) and replace the origin key in your checkout configuration. Origin keys are deprecated and will eventually stop working.',
  CLIENT_KEY_WARN_URL:
    'https://docs.adyen.com/development-resources/client-side-authentication/migrate-from-origin-key-to-client-key/',

  COUNTRY_CODE_SKIP_TITLE: 'Country code check skipped.',
  COUNTRY_CODE_PARTIAL_NOTICE_TITLE: 'countryCode presence cannot be verified.',
  COUNTRY_CODE_PASS_TITLE: 'countryCode is set correctly.',
  COUNTRY_CODE_FAIL_TITLE: 'countryCode is not set in the checkout configuration.',
  COUNTRY_CODE_FAIL_DETAIL:
    "countryCode is required to ensure the correct payment methods are shown for the shopper's country.",
  COUNTRY_CODE_FAIL_REMEDIATION:
    "Set the countryCode property in your AdyenCheckout configuration to the ISO 3166-1 alpha-2 code for the shopper's country. This is required to display the correct payment methods for that market and to route the payment correctly.",
  COUNTRY_CODE_FAIL_URL: 'https://docs.adyen.com/development-resources/testing/',

  LOCALE_SKIP_TITLE: 'Locale check skipped.',
  LOCALE_PARTIAL_NOTICE_TITLE: 'locale presence cannot be verified.',
  LOCALE_PASS_TITLE: 'locale is set correctly.',
  LOCALE_MISSING_WARN_TITLE:
    'locale is not explicitly set — language will be determined automatically.',
  LOCALE_MISSING_WARN_DETAIL:
    'Without locale, checkout UI language and number formatting may be incorrect for the shopper, degrading conversion.',
  LOCALE_MISSING_WARN_REMEDIATION:
    'Set the locale property in your AdyenCheckout configuration to an IETF language tag (such as en-US or nl-NL) that is supported by Adyen Web. This ensures consistent language and number formatting for shoppers regardless of their browser settings.',
  LOCALE_MISSING_WARN_URL: 'https://docs.adyen.com/online-payments/build-your-integration/',
  // LOCALE_UNSUPPORTED_WARN_TITLE stays inline (dynamic: uses config.locale)
  LOCALE_UNSUPPORTED_WARN_DETAIL:
    'Use a locale that exists in Adyen Web server translations to avoid unexpected language fallback.',
  LOCALE_UNSUPPORTED_WARN_REMEDIATION:
    'Update the locale property in your AdyenCheckout configuration to a locale string included in the Adyen Web server translations list. Using an unsupported locale may result in an unexpected language fallback for shoppers.',
  LOCALE_UNSUPPORTED_WARN_URL:
    'https://github.com/Adyen/adyen-web/tree/522975889a4287fe9c81cc138fcf3457e6bd5a6e/packages/server/translations',
} as const;

const CATEGORY = 'auth' as const;
const SUPPORTED_LOCALES = new Set<string>(
  ADYEN_WEB_TRANSLATION_LOCALES.map((l) => l.toLowerCase())
);

export const AUTH_CHECKS = createRegistry(CATEGORY)
  .add('auth-client-key', (payload, { pass, skip, warn }) => {
    const clientKey = payload.page.checkoutConfig?.clientKey;

    if (clientKey === undefined || clientKey === '') {
      return skip(STRINGS.CLIENT_KEY_SKIP_TITLE, STRINGS.CLIENT_KEY_SKIP_REASON);
    }

    if (clientKey.startsWith(ORIGIN_KEY_PREFIX)) {
      return warn(
        STRINGS.CLIENT_KEY_WARN_TITLE,
        `The value "${clientKey.slice(0, 12)}…" starts with "pub.v2." indicating an origin key. Origin keys are deprecated and will be deactivated; checkout will stop working without migrating to client keys.`,
        STRINGS.CLIENT_KEY_WARN_REMEDIATION,
        STRINGS.CLIENT_KEY_WARN_URL
      );
    }

    return pass(STRINGS.CLIENT_KEY_PASS_TITLE);
  })
  .add('auth-country-code', (payload, { pass, fail, skip, warn, notice }) => {
    const config = payload.page.checkoutConfig;
    const inferred = payload.page.inferredConfig;

    if (config?.countryCode !== undefined && config.countryCode !== '') {
      return pass(STRINGS.COUNTRY_CODE_PASS_TITLE);
    }

    if (inferred?.countryCode !== undefined && inferred.countryCode !== '') {
      return pass(STRINGS.COUNTRY_CODE_PASS_TITLE);
    }

    if (!config) {
      if (inferred) {
        return notice(
          STRINGS.COUNTRY_CODE_PARTIAL_NOTICE_TITLE,
          'The full checkout configuration could not be intercepted (only partial network signals were captured). Manual verification is required to ensure countryCode is set.',
          undefined,
          STRINGS.COUNTRY_CODE_FAIL_URL
        );
      }

      return skip(STRINGS.COUNTRY_CODE_SKIP_TITLE, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
    }

    const flow = detectIntegrationFlow(payload);
    if (flow === 'sessions') {
      return warn(
        STRINGS.COUNTRY_CODE_FAIL_TITLE,
        'Sessions flow typically sets countryCode server-side in the /sessions request. Setting it in the client config is still recommended for optimal payment method filtering.',
        STRINGS.COUNTRY_CODE_FAIL_REMEDIATION,
        STRINGS.COUNTRY_CODE_FAIL_URL
      );
    }

    return fail(
      STRINGS.COUNTRY_CODE_FAIL_TITLE,
      STRINGS.COUNTRY_CODE_FAIL_DETAIL,
      STRINGS.COUNTRY_CODE_FAIL_REMEDIATION,
      STRINGS.COUNTRY_CODE_FAIL_URL
    );
  })
  .add('auth-locale', (payload, { pass, skip, warn, notice }) => {
    const config = payload.page.checkoutConfig;
    const inferred = payload.page.inferredConfig;

    const locale = config?.locale ?? inferred?.locale;

    if (locale !== undefined && locale !== '') {
      if (!SUPPORTED_LOCALES.has(locale.toLowerCase())) {
        return warn(
          `locale "${locale}" is not in the supported Adyen Web translations list.`,
          STRINGS.LOCALE_UNSUPPORTED_WARN_DETAIL,
          STRINGS.LOCALE_UNSUPPORTED_WARN_REMEDIATION,
          STRINGS.LOCALE_UNSUPPORTED_WARN_URL
        );
      }
      return pass(STRINGS.LOCALE_PASS_TITLE);
    }

    if (!config) {
      if (inferred) {
        return notice(
          STRINGS.LOCALE_PARTIAL_NOTICE_TITLE,
          'The full checkout configuration could not be intercepted (only partial network signals were captured). Manual verification is required to ensure locale is set.',
          undefined,
          STRINGS.LOCALE_MISSING_WARN_URL
        );
      }

      return skip(STRINGS.LOCALE_SKIP_TITLE, SKIP_REASONS.CHECKOUT_CONFIG_NOT_DETECTED);
    }

    return warn(
      STRINGS.LOCALE_MISSING_WARN_TITLE,
      STRINGS.LOCALE_MISSING_WARN_DETAIL,
      STRINGS.LOCALE_MISSING_WARN_REMEDIATION,
      STRINGS.LOCALE_MISSING_WARN_URL
    );
  })
  .getChecks();
