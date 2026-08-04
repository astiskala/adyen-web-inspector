import type { JSX } from 'preact';
import type { StandardCompliance } from '~shared/types';
import styles from './StandardComplianceBadge.module.css';

const s = (key: string): string => styles[key] ?? '';

const STANDARD_PAYMENTS_INTEGRATION_DOCS_URL = 'https://docs.adyen.com/standard';

interface Props {
  readonly compliance: StandardCompliance;
}

/** Displays the browser-visible Standard Drop-in assessment. */
export function StandardComplianceBadge({ compliance }: Props): JSX.Element {
  const { compliant, reasons } = compliance;

  return (
    <div class={s('container')}>
      <div class={s('header')}>
        <span class={`${s('icon')} ${compliant ? s('iconCompliant') : s('iconNonCompliant')}`}>
          {compliant ? '\u2713' : '\u2717'}
        </span>
        <span class={s('title')}>
          {compliant
            ? 'Standard Drop-in frontend criteria met'
            : 'Standard Drop-in criteria not met'}
        </span>
      </div>
      {!compliant && reasons.length > 0 && (
        <ul class={s('reasons')}>
          {reasons.map((reason) => (
            <li key={reason} class={s('reason')}>
              {reason}
            </li>
          ))}
        </ul>
      )}
      <div class={s('caveat')}>
        This is not a compliance determination. Server-side API version, webhooks, account setup,
        security, testing, and go-live requirements require manual review. See the{' '}
        <a href={STANDARD_PAYMENTS_INTEGRATION_DOCS_URL} target="_blank" rel="noopener noreferrer">
          Standard integration checklist
        </a>
        {'.'}
      </div>
    </div>
  );
}
