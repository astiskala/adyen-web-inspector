import type { JSX, Ref } from 'preact';
import { InspectorIcon } from './components/InspectorIcon.js';
import { cssModule } from './components/css-module.js';
import type { Theme } from './components/useTheme.js';
import styles from './PopupApp.module.css';

const s = cssModule(styles);
const THEMES = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

const DETAIL_LEVELS = [
  { detailed: false, label: 'Essential', description: 'Score and checks only.' },
  {
    detailed: true,
    label: 'Detailed',
    description: 'Adds scan time, fixes, implementation details and the criteria explainer.',
  },
] as const;

interface Properties {
  readonly backButton: Ref<HTMLButtonElement>;
  readonly onBack: () => void;
  readonly theme: Theme;
  readonly onTheme: (theme: Theme) => void;
  readonly detailed: boolean;
  readonly onDetail: (isDetailed: boolean) => void;
  readonly version: string;
}

/**
The popup's appearance settings, with keyboard-operable native radio groups.
*/
export function Settings({
  backButton,
  onBack,
  theme,
  onTheme,
  detailed,
  onDetail,
  version,
}: Properties): JSX.Element {
  return (
    <main class={s('settings')}>
      <header class={s('settingsHeader')}>
        <button class="btn" ref={backButton} onClick={onBack}>
          <InspectorIcon name="back" /> Back
        </button>
        <h1>Settings</h1>
      </header>
      <fieldset>
        <legend>Theme</legend>
        <div class={s('segments')}>
          {THEMES.map(({ value, label }) => (
            <label key={value}>
              <input
                class="visuallyHidden"
                type="radio"
                name="theme"
                value={value}
                checked={value === theme}
                onChange={() => {
                  onTheme(value);
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p class={s('caption')}>Match system follows your browser’s theme.</p>
      </fieldset>
      <fieldset>
        <legend>Detail level</legend>
        {DETAIL_LEVELS.map((level) => (
          <label class={s('choice')} key={level.label}>
            <input
              type="radio"
              name="detail"
              checked={level.detailed === detailed}
              onChange={() => {
                onDetail(level.detailed);
              }}
            />
            <span>
              {level.label}
              <small>{level.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <p class={s('caption')}>Version {version}</p>
    </main>
  );
}
