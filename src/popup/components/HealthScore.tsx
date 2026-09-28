import type { JSX } from 'preact';
import type { ScanResult } from '../../shared/types.js';
import styles from './HealthScore.module.css';

const s = (key: string): string => styles[key] ?? '';

interface Props {
  readonly result: ScanResult;
}

const TIER_CLASSES: Readonly<
  Record<ScanResult['health']['tier'], { readonly score: string; readonly fill: string }>
> = {
  excellent: { score: 'scoreExcellent', fill: 'fillExcellent' },
  issues: { score: 'scoreIssues', fill: 'fillIssues' },
  critical: { score: 'scoreCritical', fill: 'fillCritical' },
};

/**
 * Displays the scan health score, pass ratio, and progress bar indicator.
 */
export function HealthScore({ result }: Props): JSX.Element {
  const { score, passing, total, tier } = result.health;
  const scoreClass = s(TIER_CLASSES[tier].score);
  const fillClasses = `${s('fill')} ${s(TIER_CLASSES[tier].fill)}`;

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
