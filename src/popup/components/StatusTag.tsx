import type { JSX } from 'preact';
import { InspectorIcon } from './InspectorIcon.js';
import styles from './StatusTag.module.css';
import { cssModule } from './css-module.js';

const s = cssModule(styles);

/**
Pairs a plain-text status with a shape and an optional tinted tag.
*/
export function StatusTag({
  tone,
  children,
  plain = false,
}: {
  readonly tone: 'fail' | 'warn' | 'pass' | 'notice';
  readonly children: string;
  readonly plain?: boolean;
}): JSX.Element {
  return (
    <span class={s(plain ? 'plain' : 'tag')} data-tone={tone}>
      <InspectorIcon name={tone} />
      {children}
    </span>
  );
}
