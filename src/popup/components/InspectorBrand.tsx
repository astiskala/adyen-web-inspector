import type { JSX } from 'preact';

/**
The Inspector mark and product name used in the popup and report.
*/
export function InspectorBrand(): JSX.Element {
  return (
    <span class="inspectorBrand">
      <img src="/assets/icon-48.png" width="24" height="24" alt="" />
      <span>Adyen Web Inspector</span>
    </span>
  );
}
