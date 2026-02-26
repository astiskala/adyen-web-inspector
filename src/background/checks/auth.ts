import { ADYEN_WEB_TRANSLATION_LOCALES, ORIGIN_KEY_PREFIX } from '../../shared/constants.js';
import { createRegistry } from './registry.js';

const CATEGORY = 'auth' as const;
const SUPPORTED_LOCALES = new Set<string>(ADYEN_WEB_TRANSLATION_LOCALES);

export const AUTH_CHECKS = createRegistry(CATEGORY)
  .add('auth-client-key', (payload, { pass, skip, warn }) => {
    const clientKey = payload.page.checkoutConfig?.clientKey;

    if (clientKey === undefined || clientKey === '') {
      return skip('Client key check skipped — key not detected in page config.');
    }

    if (clientKey.startsWith(ORIGIN_KEY_PREFIX)) {
      return warn(
        'Origin key detected — migrate to a client key.',
        `The value "${clientKey.slice(0, 12)}…" starts with "pub.v2." indicating an origin key. Origin keys are deprecated and will be deactivated; checkout will stop working without migrating to client keys.`,
        'Generate a client key in the Adyen Customer Area (Developers → API credentials → Client-side integration) and replace the origin key in your checkout configuration. Origin keys are deprecated and will eventually stop working.',
        'https://docs.adyen.com/development-resources/client-side-authentication/migrate-from-origin-key-to-client-key/'
      );
    }

    return pass('Client key (not an origin key) is in use.');
  })
  .add('auth-country-code', (payload, { pass, fail, skip }) => {
    const config = payload.page.checkoutConfig;
    if (!config) {
      return skip('Country code check skipped — checkout config not detected.');
    }

    if (config.countryCode === undefined || config.countryCode === '') {
      return fail(
        'countryCode is not set in the checkout configuration.',
        "countryCode is required to ensure the correct payment methods are shown for the shopper's country.",
        "Set the countryCode property in your AdyenCheckout configuration to the ISO 3166-1 alpha-2 code for the shopper's country. This is required to display the correct payment methods for that market and to route the payment correctly.",
        'https://docs.adyen.com/development-resources/testing/'
      );
    }

    return pass('countryCode is set correctly.');
  })
  .add('auth-locale', (payload, { pass, skip, warn }) => {
    const config = payload.page.checkoutConfig;
    if (!config) {
      return skip('Locale check skipped — checkout config not detected.');
    }

    if (config.locale === undefined || config.locale === '') {
      return warn(
        'locale is not explicitly set — language will be determined automatically.',
        'Without locale, checkout UI language and number formatting may be incorrect for the shopper, degrading conversion.',
        'Set the locale property in your AdyenCheckout configuration to an IETF language tag (such as en-US or nl-NL) that is supported by Adyen Web. This ensures consistent language and number formatting for shoppers regardless of their browser settings.',
        'https://docs.adyen.com/online-payments/build-your-integration/'
      );
    }

    if (!SUPPORTED_LOCALES.has(config.locale)) {
      return warn(
        `locale "${config.locale}" is not in the supported Adyen Web translations list.`,
        'Use a locale that exists in Adyen Web server translations to avoid unexpected language fallback.',
        'Update the locale property in your AdyenCheckout configuration to a locale string included in the Adyen Web server translations list. Using an unsupported locale may result in an unexpected language fallback for shoppers.',
        'https://github.com/Adyen/adyen-web/tree/522975889a4287fe9c81cc138fcf3457e6bd5a6e/packages/server/translations'
      );
    }

    return pass('locale is set correctly.');
  })
  .getChecks();
