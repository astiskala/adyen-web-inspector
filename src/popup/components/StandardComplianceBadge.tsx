import type { JSX } from 'preact';
import { STANDARD_COMPLIANCE_COPY } from '../../shared/standard-compliance.js';
import type { StandardCompliance } from '../../shared/types.js';
import styles from './StandardComplianceBadge.module.css';
import { cssModule } from './css-module.js';

const s = cssModule(styles);

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
          {compliant ? STANDARD_COMPLIANCE_COPY.metLabel : STANDARD_COMPLIANCE_COPY.unmetLabel}
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
        {STANDARD_COMPLIANCE_COPY.caveat} See the{' '}
        <a href={STANDARD_COMPLIANCE_COPY.checklistUrl} target="_blank" rel="noopener noreferrer">
          {STANDARD_COMPLIANCE_COPY.checklistLabel}
        </a>
        {'.'}
      </div>
    </div>
  );
}
