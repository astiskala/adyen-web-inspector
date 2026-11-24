import type { ComponentChildren, ComponentProps, JSX, Ref } from 'preact';
import { InspectorIcon } from './InspectorIcon.js';
import styles from './EmptyState.module.css';
import { cssModule } from './css-module.js';

const s = cssModule(styles);

interface ScanAction {
  readonly label: string;
  readonly hint?: string;
  readonly scanning?: boolean;
  readonly onScan: () => void;
  readonly buttonRef?: Ref<HTMLButtonElement>;
}

interface EmptyStateProperties {
  readonly icon: ComponentProps<typeof InspectorIcon>['name'];
  readonly title: string;
  readonly tone?: 'neutral' | 'warn' | 'pass' | 'fail';
  readonly scanAction?: ScanAction;
  readonly link?: { readonly href: string; readonly label: string };
  readonly children?: ComponentChildren;
}

/**
Centred state with an icon, explanatory text, and an optional scan or docs action.
*/
export function EmptyState({
  icon,
  title,
  tone = 'neutral',
  scanAction,
  link,
  children,
}: EmptyStateProperties): JSX.Element {
  return (
    <div class={s('container')}>
      <span class={s('icon')} data-tone={tone}>
        <InspectorIcon name={icon} />
      </span>
      <div role="status">
        <h2 class={s('title')}>{title}</h2>
        <div class={s('body')}>{children}</div>
      </div>
      {scanAction !== undefined && (
        <div>
          {scanAction.hint !== undefined && <p class={s('actionHint')}>{scanAction.hint}</p>}
          <button
            class={`btn btnPrimary ${s('actionButton')}`}
            ref={scanAction.buttonRef ?? null}
            onClick={scanAction.onScan}
            disabled={scanAction.scanning}
          >
            <InspectorIcon name={scanAction.scanning === true ? 'spinner' : 'scan'} />
            {scanAction.label}
          </button>
        </div>
      )}
      {link !== undefined && (
        <a href={link.href} target="_blank" rel="noopener noreferrer">
          {link.label} <InspectorIcon name="external" />
        </a>
      )}
    </div>
  );
}
