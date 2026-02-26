import type { JSX } from 'preact';
import type { ScanResult } from '~shared/types';
import styles from './HealthScore.module.css';

const s = (key: string): string => styles[key] ?? '';

interface Props {
  readonly result: ScanResult;
}

function tierClass(tier: string): string {
  if (tier === 'excellent') return 'Excellent';
  if (tier === 'good') return 'Good';
  if (tier === 'issues') return 'Issues';
  return 'Critical';
}

/**
 * Displays the scan health score, pass ratio, and progress bar indicator.
 */
export function HealthScore({ result }: Props): JSX.Element {
  const { score, passing, total, tier } = result.health;
  const t = tierClass(tier);
  const scoreClass = s(`score${t}`);
  const fillClass = s(`fill${t}`);
  const fillClasses = `${s('fill')} ${fillClass}`.trim();

  return (
    <div class={s('container')}>
      <div class={s('header')}>
        <span class={s('title')}>Health Score</span>
        <div class={s('scoreWrap')}>
          <span class={s('meta')}>
            {passing}/{total} checks passing
          </span>
          <span class={scoreClass}>{score}</span>
        </div>
      </div>
      <div class={s('bar')}>
        <div class={fillClasses} style={`width:${score}%`} />
      </div>
    </div>
  );
}
