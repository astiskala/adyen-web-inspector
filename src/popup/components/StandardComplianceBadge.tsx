import type { JSX } from 'preact';
import { STANDARD_COMPLIANCE_COPY } from '../../shared/standard-compliance.js';
import type { StandardCompliance } from '../../shared/types.js';
import { InspectorIcon } from './InspectorIcon.js';
import styles from './StandardComplianceBadge.module.css';
import { cssModule } from './css-module.js';

const s = cssModule(styles);

interface Properties {
  readonly compliance: StandardCompliance;
  readonly detailed?: boolean;
}

/**
Displays the browser-visible Standard Drop-in assessment.
*/
export function StandardComplianceBadge({ compliance, detailed = true }: Properties): JSX.Element {
  const { compliant, reasons } = compliance;
  const tone = compliant ? 'pass' : 'fail';

  return (
    <div class={s('container')} data-tone={tone}>
      <div class={s('header')}>
        <InspectorIcon name={tone} />
        <span>
          {compliant ? STANDARD_COMPLIANCE_COPY.metLabel : STANDARD_COMPLIANCE_COPY.unmetLabel}
        </span>
      </div>
      {detailed && !compliant && reasons.length > 0 && (
        <ul class={s('reasons')}>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {detailed && (
        <p class={s('caveat')}>
          {STANDARD_COMPLIANCE_COPY.caveat} See the{' '}
          <a href={STANDARD_COMPLIANCE_COPY.checklistUrl} target="_blank" rel="noopener noreferrer">
            {STANDARD_COMPLIANCE_COPY.checklistLabel}
          </a>
          {'.'}
        </p>
      )}
    </div>
  );
}
