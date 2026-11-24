import type { JSX } from 'preact';
import type { AdyenEnvironment, ScanResult } from '../../shared/types.js';
import { summarizeImplementation } from '../../shared/export-report.js';
import { INTEGRATION_FLOW_LABELS } from '../../shared/constants.js';
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

/**
 * Shows derived implementation attributes for the current checkout page.
 */
export function IdentityCard({ result }: Properties): JSX.Element {
  const attributes = summarizeImplementation(result);
  const environment = attributes.environment;
  const isShowRegion = attributes.region !== null;

  return (
    <div class={s('card')}>
      <h2>Implementation Attributes</h2>
      <div class={s('row')}>
        <span class={s('label')}>Version</span>
        <span class={`${s('value')} monospace`}>{attributes.sdkVersion}</span>
      </div>
      <div class={s('row')}>
        <span class={s('label')}>Environment</span>
        <span class={`${s('badge')} ${s(ENVIRONMENT_BADGES[environment])}`}>{environment}</span>
      </div>
      {isShowRegion && (
        <div class={s('row')}>
          <span class={s('label')}>Region</span>
          <span class={s('value')}>{attributes.region}</span>
        </div>
      )}
      <div class={s('row')}>
        <span class={s('label')}>Flow</span>
        <span class={s('value')}>{INTEGRATION_FLOW_LABELS[attributes.flow]}</span>
      </div>
      <div class={s('row')}>
        <span class={s('label')}>Flavor</span>
        <span class={s('value')}>{attributes.flavor}</span>
      </div>
      <div class={s('row')}>
        <span class={s('label')}>Import</span>
        <span class={s('value')}>{attributes.importMethod}</span>
      </div>
    </div>
  );
}
