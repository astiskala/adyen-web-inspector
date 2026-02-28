import type { JSX } from 'preact';
import type { ScanResult } from '../../shared/types.js';
import {
  buildImplementationAttributes,
  type IntegrationFlow,
} from '../../shared/implementation-attributes.js';
import styles from './IdentityCard.module.css';

interface Props {
  readonly result: ScanResult;
}

const s = (key: string): string => styles[key] ?? '';

function envBadgeClass(env: string): string {
  if (env === 'test') return s('badgeTest');
  if (env === 'live' || env === 'live-in') return s('badgeLive');
  return s('badgeUnknown');
}

function normalizeFlow(flow: IntegrationFlow): string {
  if (flow === 'sessions') return 'Sessions';
  if (flow === 'advanced') return 'Advanced';
  return 'Unknown';
}

/**
 * Shows derived implementation attributes for the current checkout page.
 */
export function IdentityCard({ result }: Props): JSX.Element {
  const attrs = buildImplementationAttributes(result.payload);
  const env = attrs.environment;
  const showRegion = attrs.region !== null;

  return (
    <div class={s('card')}>
      <h2>Implementation Attributes</h2>
      <div class={s('row')}>
        <span class={s('label')}>Version</span>
        <span class={`${s('value')} monospace`}>{attrs.sdkVersion}</span>
      </div>
      <div class={s('row')}>
        <span class={s('label')}>Environment</span>
        <span class={`${s('badge')} ${envBadgeClass(env)}`}>{env}</span>
      </div>
      {showRegion && (
        <div class={s('row')}>
          <span class={s('label')}>Region</span>
          <span class={s('value')}>{attrs.region}</span>
        </div>
      )}
      <div class={s('row')}>
        <span class={s('label')}>Flow</span>
        <span class={s('value')}>{normalizeFlow(attrs.flow)}</span>
      </div>
      <div class={s('row')}>
        <span class={s('label')}>Flavor</span>
        <span class={s('value')}>{attrs.flavor}</span>
      </div>
      <div class={s('row')}>
        <span class={s('label')}>Import</span>
        <span class={s('value')}>{attrs.importMethod}</span>
      </div>
    </div>
  );
}
