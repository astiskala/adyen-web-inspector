import type { ComponentChildren, JSX } from 'preact';
import styles from './EmptyState.module.css';
import { cssModule } from './css-module.js';

const s = cssModule(styles);

interface ScanAction {
  readonly label: string;
  readonly hint?: string;
  readonly scanning: boolean;
  readonly onScan: () => void;
}

interface EmptyStateLink {
  readonly href: string;
  readonly label: string;
}

interface EmptyStateProps {
  readonly icon: string;
  readonly title: string;
  readonly tone?: 'neutral' | 'warning';
  readonly scanAction?: ScanAction;
  readonly link?: EmptyStateLink;
  readonly children: ComponentChildren;
}

/**
 * Centered popup state with an icon, a title, explanatory text, and an
 * optional scan button or documentation link.
 */
export function EmptyState({
  icon,
  title,
  tone = 'neutral',
  scanAction,
  link,
  children,
}: EmptyStateProps): JSX.Element {
  const titleClass = tone === 'warning' ? `${s('title')} ${s('titleWarning')}` : s('title');

  return (
    <div class={s('container')}>
      <div class={s('icon')}>{icon}</div>
      <div class={titleClass}>{title}</div>
      <div class={s('body')}>{children}</div>
      {scanAction !== undefined && (
        <div class={s('action')}>
          {scanAction.hint !== undefined && <div class={s('actionHint')}>{scanAction.hint}</div>}
          <button
            class={`btn ${scanAction.scanning ? '' : 'btnPrimary'} ${s('actionButton')}`}
            onClick={scanAction.onScan}
            disabled={scanAction.scanning}
          >
            {scanAction.scanning ? 'Scanning…' : scanAction.label}
          </button>
        </div>
      )}
      {link !== undefined && (
        <a class={s('link')} href={link.href} target="_blank" rel="noopener noreferrer">
          {link.label}
        </a>
      )}
    </div>
  );
}
