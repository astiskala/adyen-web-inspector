import type { JSX } from 'preact';
import { HEALTH_TIER_LABELS } from '../../shared/constants.js';
import type { ScanResult } from '../../shared/types.js';
import { StatusTag } from './StatusTag.js';
import styles from './HealthScore.module.css';
import { cssModule } from './css-module.js';

const s = cssModule(styles);

const TIER_TONES = { excellent: 'pass', issues: 'warn', critical: 'fail' } as const;

/**
The scan's tier in words and as a status tag.
*/
export function HealthTier({ tier }: { readonly tier: ScanResult['health']['tier'] }): JSX.Element {
  return <StatusTag tone={TIER_TONES[tier]}>{HEALTH_TIER_LABELS[tier]}</StatusTag>;
}

/**
Displays scan health, the pass ratio, and, in detailed views, how tiers work.
*/
export function HealthScore({
  result,
  detailed = true,
}: {
  readonly result: ScanResult;
  readonly detailed?: boolean;
}): JSX.Element {
  const { score, passing, total, tier } = result.health;
  const tone = TIER_TONES[tier];
  const label = HEALTH_TIER_LABELS[tier];

  return (
    <section class={s('container')} aria-label="Health score">
      <div class={s('title')}>Health score</div>
      <div class={s('scoreWrap')}>
        <span class={s('score')}>
          {score}
          <small>/100</small>
        </span>
        <HealthTier tier={tier} />
      </div>
      <div
        class={s('bar')}
        data-tone={tone}
        role="meter"
        aria-label="Health score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-valuetext={`${score} of 100, ${label}`}
      >
        <div class={s('fill')} style={`width:${score}%`} />
      </div>
      <p class={s('meta')}>
        {passing} of {total} checks passing
        {detailed &&
          `. Any fail makes the tier ${HEALTH_TIER_LABELS.critical}; otherwise, any warning makes it ${HEALTH_TIER_LABELS.issues}. Notices do not affect the tier.`}
      </p>
    </section>
  );
}
