import type { JSX } from 'preact';
import type { AdyenEnvironment, ScanResult } from '../../shared/types.js';
import { implementationRows, summarizeImplementation } from '../../shared/export-report.js';
import styles from './IdentityCard.module.css';
import { cssModule } from './css-module.js';

interface Properties {
  readonly result: ScanResult;
}

const s = cssModule(styles);

const ENVIRONMENT_BADGES: Readonly<Record<AdyenEnvironment | 'unknown', string>> = {
  test: 'badgeTest',
  live: 'badgeLive',
  'live-in': 'badgeLive',
  unknown: 'badgeUnknown',
};

type Row = ReturnType<typeof implementationRows>[number];

function valueClass(key: Row['key'], environment: AdyenEnvironment | 'unknown'): string {
  if (key === 'environment') return `${s('badge')} ${s(ENVIRONMENT_BADGES[environment])}`;
  return key === 'sdkVersion' ? `${s('value')} monospace` : s('value');
}

/**
Shows derived implementation attributes for the current checkout page.
*/
export function IdentityCard({ result }: Properties): JSX.Element {
  const summary = summarizeImplementation(result);

  return (
    <div class={s('card')}>
      <h2>Implementation Attributes</h2>
      {implementationRows(summary).map((row) => (
        <div key={row.key} class={s('row')}>
          <span class={s('label')}>{row.label}</span>
          <span class={valueClass(row.key, summary.environment)}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}
