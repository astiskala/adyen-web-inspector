/**
 * Styling checks (`sdk-identity`) — CSS custom properties vs class overrides.
 */

import type { AdyenStyleInfo } from '../../shared/types.js';
import { createRegistry } from './registry.js';

const CATEGORY = 'sdk-identity' as const;

const STRINGS = {
  SKIP_TITLE: 'CSS styling check skipped.',
  SKIP_REASON: 'No custom Adyen styling detected on this page.',
  // PASS_TITLE stays inline (dynamic: uses the custom property count)
  NOTICE_TITLE: 'Adyen components styled via CSS class overrides instead of CSS custom properties.',
  // NOTICE_DETAIL is built by buildOverrideDetail (dynamic: uses rule counts and selectors)
  NOTICE_DETAIL_ADVICE:
    'Adyen Web v6 uses CSS custom properties for styling. Consider migrating for better upgrade compatibility.',
  NOTICE_REMEDIATION:
    'Migrate CSS class name overrides (.adyen-checkout__*) to --adyen-sdk-* CSS custom properties for better compatibility with future SDK upgrades.',
  NOTICE_URL:
    'https://docs.adyen.com/online-payments/upgrade-your-integration/upgrade-to-web-v6#upgrade-your-styling',
} as const;

const MAX_SELECTOR_EXAMPLES = 3;
const ADYEN_SELECTOR_START_PATTERN = /\.adyen-checkout__[^\s,>+~:]*/;

function pluralRules(count: number): string {
  return `${count} rule${count === 1 ? '' : 's'}`;
}

/** The selector from its first Adyen class on; empty for selectors in the group that do not target Adyen. */
function focusAdyenSelector(selector: string): string {
  const normalized = selector.replaceAll(/\s+/g, ' ').trim();
  const firstAdyenClass = ADYEN_SELECTOR_START_PATTERN.exec(normalized);
  return firstAdyenClass === null ? '' : normalized.slice(firstAdyenClass.index);
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
  parts.push(STRINGS.NOTICE_DETAIL_ADVICE);
  return parts.join(' ');
}

export const STYLING_CHECKS = createRegistry(CATEGORY)
  .add(
    'styling-css-custom-props',
    (payload, { skip, pass, notice }) => {
      const styles = payload.page.adyenStyles;

      const hasOverrides = styles.classOverrideCount > 0;
      const hasCustomProps = styles.customPropertyCount > 0;

      if (!hasOverrides && !hasCustomProps) {
        return skip(STRINGS.SKIP_TITLE, STRINGS.SKIP_REASON);
      }

      if (!hasOverrides && hasCustomProps) {
        return pass(
          `Adyen components styled using CSS custom properties (${pluralRules(styles.customPropertyCount)} found).`
        );
      }

      return notice(
        STRINGS.NOTICE_TITLE,
        buildOverrideDetail(styles),
        STRINGS.NOTICE_REMEDIATION,
        STRINGS.NOTICE_URL
      );
    },
    { noticeImpact: 'low' }
  )
  .getChecks();
