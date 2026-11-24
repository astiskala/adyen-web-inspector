import type { JSX } from 'preact';
import type { ScanResult } from '../../shared/types.js';
import { implementationRows, summarizeImplementation } from '../../shared/export-report.js';
import styles from './IdentityCard.module.css';
import { cssModule } from './css-module.js';

interface Properties {
  readonly result: ScanResult;
}

const s = cssModule(styles);

/**
Shows derived implementation attributes for the current checkout page.
*/
export function IdentityCard({ result }: Properties): JSX.Element {
  const summary = summarizeImplementation(result);

  return (
    <section class={s('card')}>
      <h2>Implementation attributes</h2>
      <dl>
        {implementationRows(summary).map((row) => (
          <div key={row.key} class={s('row')}>
            <dt class={s('label')}>{row.label}</dt>
            <dd class={row.key === 'sdkVersion' ? `${s('value')} monospace` : s('value')}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
