import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { InspectorIcon } from './InspectorIcon.js';
import styles from './CodeSection.module.css';
import { cssModule } from './css-module.js';

const s = cssModule(styles);

/**
Displays one source of extracted config with an explicit clipboard action.
*/
export function CodeSection({
  title,
  text,
}: {
  readonly title: string;
  readonly text: string;
}): JSX.Element {
  const [feedback, setFeedback] = useState('');

  async function copy(): Promise<void> {
    try {
      await globalThis.navigator.clipboard.writeText(text);
      setFeedback('Copied');
    } catch {
      setFeedback('Could not copy');
    }
  }

  return (
    <section class={s('card')}>
      <div class={s('header')}>
        <h3>{title}</h3>
        <span class={s('feedback')} role="status">
          {feedback}
        </span>
        <button
          class={`btn btnIcon ${s('copy')}`}
          aria-label={`Copy ${title}`}
          onClick={() => {
            void copy();
          }}
        >
          <InspectorIcon name="copy" />
        </button>
      </div>
      <pre class={s('code')}>{text}</pre>
    </section>
  );
}
