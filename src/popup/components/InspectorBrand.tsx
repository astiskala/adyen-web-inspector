import type { JSX } from 'preact';

/**
Wordmark geometry from the public Adyen press kit, tinted to match the report and popup.
*/
export function InspectorBrand(): JSX.Element {
  return (
    <span class="inspectorBrand">
      <svg width="62" height="21" viewBox="76 60 216 71" aria-hidden="true">
        <path
          fill="currentColor"
          d="M76 76.138h31.724a6.343 6.343 0 0 1 6.345 6.345v31.724H82.345A6.343 6.343 0 0 1 76 107.862V92h15.862v12.69h6.345V85.655H76zM253.655 76.138v38.069h15.862V85.655h6.345v28.552h15.862V82.483a6.343 6.343 0 0 0-6.345-6.345zM164.828 130.069h31.724a6.343 6.343 0 0 0 6.345-6.345V76.138h-15.863v28.552h-6.344V76.138h-15.862v31.724a6.343 6.343 0 0 0 6.344 6.345h15.862v6.345h-22.206zM247.31 114.207h-31.724a6.343 6.343 0 0 1-6.345-6.345V76.138h31.725a6.343 6.343 0 0 1 6.344 6.345v15.862h-15.862v-12.69h-6.345v19.035h22.207zM158.483 60.276v53.931h-31.724a6.343 6.343 0 0 1-6.345-6.345v-25.38a6.343 6.343 0 0 1 6.345-6.344h9.517v28.552h6.345V60.276z"
        />
      </svg>
      <span class="visuallyHidden">Adyen </span>Web Inspector
    </span>
  );
}
