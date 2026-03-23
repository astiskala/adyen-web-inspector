/**
 * Styling checks — CSS custom properties vs class overrides.
 */

import type { AdyenStyleInfo } from '../../shared/types.js';
import { createRegistry } from './registry.js';

const DOCS_URL =
  'https://docs.adyen.com/online-payments/upgrade-your-integration/upgrade-to-web-v6#upgrade-your-styling';

function pluralRules(count: number): string {
  return `${count} rule${count === 1 ? '' : 's'}`;
}

function buildOverrideDetail(styles: AdyenStyleInfo): string {
  const selectorList = styles.classOverrideSelectors.join(', ');
  const parts = [
    `Found ${pluralRules(styles.classOverrideCount)} overriding Adyen class names: ${selectorList}.`,
  ];
  if (styles.customPropertyCount > 0) {
    parts.push(
      `Also found ${pluralRules(styles.customPropertyCount)} using CSS custom properties.`
    );
  }
  parts.push(
    'Adyen Web v6 uses CSS custom properties for styling.',
    'Consider migrating for better upgrade compatibility.'
  );
  return parts.join(' ');
}

const REMEDIATION =
  'Migrate CSS class name overrides (.adyen-checkout__*) to --adyen-sdk-* CSS custom properties for better compatibility with future SDK upgrades.';

export const STYLING_CHECKS = createRegistry('sdk-identity')
  .add('styling-css-custom-props', (payload, ctx) => {
    const styles = payload.page.adyenStyles;

    const hasOverrides = styles.classOverrideCount > 0;
    const hasCustomProps = styles.customPropertyCount > 0;

    if (!hasOverrides && !hasCustomProps) {
      return ctx.skip(
        'CSS styling check skipped.',
        'No custom Adyen styling detected on this page.'
      );
    }

    if (!hasOverrides && hasCustomProps) {
      return ctx.pass(
        `Adyen components styled using CSS custom properties (${pluralRules(styles.customPropertyCount)} found).`
      );
    }

    return ctx.notice(
      'Adyen components styled via CSS class overrides instead of CSS custom properties.',
      buildOverrideDetail(styles),
      REMEDIATION,
      DOCS_URL
    );
  })
  .getChecks();
