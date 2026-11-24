import type { JSX } from 'preact';
import styles from './InspectorIcon.module.css';
import { cssModule } from './css-module.js';

const s = cssModule(styles);

const paths = {
  pass: 'M7 12l3 3 7-7M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0',
  fail: 'm9 9 6 6m0-6-6 6M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0',
  warn: 'm12 3 10 18H2L12 3Zm0 7v4m0 3v.1',
  notice: 'M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0',
  settings:
    'M10 3h4l.7 2.5 2.3 1.4 2.5-.7 2 3.5-1.8 1.8v2l1.8 1.8-2 3.5-2.5-.7-2.3 1.4L14 22h-4l-.7-2.5L7 18.1l-2.5.7-2-3.5 1.8-1.8v-2L2.5 9.7l2-3.5 2.5.7 2.3-1.4L10 3Zm5 9.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  back: 'M19 12H5m6-6-6 6 6 6',
  external: 'M7 17 17 7M8 7h9v9',
  scan: 'm8 5 12 7-12 7V5Z',
  retry: 'M20 11a8 8 0 1 0-1.5 6M20 5v6h-6',
  search: 'M21 21l-6-6m3-5a8 8 0 1 1-16 0 8 8 0 1 1 16 0',
  spinner: 'M21 12a9 9 0 1 1-9-9',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',
  copy: 'M8 8h12v13H8zM16 4H4v13',
} as const;

/**
Small, decorative line icons drawn locally, with text labels supplied by the view.
*/
export function InspectorIcon({ name }: { readonly name: keyof typeof paths }): JSX.Element {
  return (
    <svg
      class={s(name === 'spinner' ? 'spinner' : 'icon')}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
