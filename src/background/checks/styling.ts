/**
 * Styling checks — CSS custom properties vs class overrides.
 */

import type { AdyenStyleInfo } from '../../shared/types.js';
import { createRegistry } from './registry.js';

const DOCS_URL =
  'https://docs.adyen.com/online-payments/upgrade-your-integration/upgrade-to-web-v6#upgrade-your-styling';
const MAX_SELECTOR_EXAMPLES = 3;
const ADYEN_SELECTOR_START_PATTERN = /\.adyen-checkout__[^\s,>+~:]*/;

function pluralRules(count: number): string {
  return `${count} rule${count === 1 ? '' : 's'}`;
}

function focusAdyenSelector(selector: string): string {
  const normalized = selector.replaceAll(/\s+/g, ' ').trim();
  const firstAdyenClass = ADYEN_SELECTOR_START_PATTERN.exec(normalized)?.[0];

  if (firstAdyenClass === undefined) {
    return normalized;
  }

  const firstIndex = normalized.indexOf(firstAdyenClass);
  return normalized.slice(firstIndex);
}

function getSelectorExamples(selectorTexts: readonly string[]): string[] {
  const examples: string[] = [];

  for (const selectorText of selectorTexts) {
    const selectors = selectorText
      .split(',')
      .map((selector) => focusAdyenSelector(selector))
      .filter((selector) => selector !== '');

    for (const selector of selectors) {
      if (examples.includes(selector)) {
        continue;
      }

      examples.push(selector);
      if (examples.length === MAX_SELECTOR_EXAMPLES) {
        return examples;
      }
    }
  }

  return examples;
}

function buildOverrideDetail(styles: AdyenStyleInfo): string {
  const selectorExamples = getSelectorExamples(styles.classOverrideSelectors);
  const omittedCount = Math.max(styles.classOverrideCount - selectorExamples.length, 0);
  const parts = [`Found ${pluralRules(styles.classOverrideCount)} overriding Adyen class names.`];

  if (selectorExamples.length > 0) {
    parts.push(`Examples: ${selectorExamples.join(', ')}.`);
  }

  if (omittedCount > 0) {
    parts.push(`${omittedCount} more selector${omittedCount === 1 ? '' : 's'} omitted.`);
  }

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
