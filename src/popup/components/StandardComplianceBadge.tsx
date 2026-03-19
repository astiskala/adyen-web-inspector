import type { JSX } from 'preact';
import type { StandardCompliance } from '~shared/types';
import styles from './StandardComplianceBadge.module.css';

const s = (key: string): string => styles[key] ?? '';

const STANDARD_INTEGRATION_DOCS_URL =
  'https://docs.adyen.com/online-payments/build-your-integration';

interface Props {
  readonly compliance: StandardCompliance;
}

/** Displays the standard integration compliance status with pass/fail indicator. */
export function StandardComplianceBadge({ compliance }: Props): JSX.Element {
  const { compliant, reasons } = compliance;

  return (
    <div class={s('container')}>
      <div class={s('header')}>
        <span class={`${s('icon')} ${compliant ? s('iconCompliant') : s('iconNonCompliant')}`}>
          {compliant ? '\u2713' : '\u2717'}
        </span>
        <span class={s('title')}>
          {compliant ? 'Standard Integration Compliant' : 'Not Standard Integration Compliant'}
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
        Note: Not all aspects of a standard integration can be assessed from the frontend. For a
        comprehensive review, see the{' '}
        <a href={STANDARD_INTEGRATION_DOCS_URL} target="_blank" rel="noopener noreferrer">
          documentation
        </a>
        {'.'}
      </div>
    </div>
  );
}
