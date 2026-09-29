import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { useScanLifecycle } from '../../popup/components/useScanLifecycle.js';
import { buildJsonExport } from '../../shared/export-json.js';
import { buildPrintableReportMetadata } from '../../shared/export-metadata.js';
import { exportPdf } from '../../popup/components/pdf-export.js';
import { describeError } from '../../shared/utils.js';
import {
  OverviewTab,
  BestPracticesTab,
  SecurityTab,
  NetworkTab,
  RawConfigTab,
  SkippedChecksTab,
} from './tabs.js';
import styles from './panel.module.css';

const s = (key: string): string => styles[key] ?? '';

const TABS = [
  'Overview',
  'Best Practices',
  'Security',
  'Skipped Checks',
  'Network',
  'Extracted Config',
] as const;
type TabName = (typeof TABS)[number];
const CONTEXT_INVALIDATED_ERROR_TEXT = 'Extension context invalidated';
const CONTEXT_INVALIDATED_UI_MESSAGE =
  'Extension context is invalidated. Reload the extension and reopen the Adyen Inspector panel.';
const RUNTIME_ERROR_UI_MESSAGE = 'Unable to communicate with the extension runtime.';
const SDK_NOT_DETECTED_MESSAGE = 'Adyen Web SDK was not detected on this page.';

function getInspectedTabId(): number {
  // chrome.devtools.inspectedWindow.tabId is synchronous and throws only if context is invalidated
  // Synchronous context invalidation is handled by the scan lifecycle module.
  return chrome.devtools.inspectedWindow.tabId;
}

const devtoolsTabAdapter = { getTabId: getInspectedTabId } as const;

function isContextInvalidated(error: unknown): boolean {
  return describeError(error).includes(CONTEXT_INVALIDATED_ERROR_TEXT);
}

function getPanelErrorMessage(error: ReturnType<typeof useScanLifecycle>['error']): string {
  if (error === null) return '';
  if (error.kind === 'scan') return error.message ?? 'Scan failed. Try reloading the page.';
  if (error.kind === 'tab') return RUNTIME_ERROR_UI_MESSAGE;
  if (isContextInvalidated(error.cause)) return CONTEXT_INVALIDATED_UI_MESSAGE;
  return error.kind === 'request'
    ? 'Unable to start scan. Try reloading the page.'
    : RUNTIME_ERROR_UI_MESSAGE;
}

/**
 * DevTools panel root that coordinates scan lifecycle, exports, and tab views.
 */
export function Panel(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabName>('Overview');
  const { result, scanning, error, scan } = useScanLifecycle(devtoolsTabAdapter);
  const errorMsg = getPanelErrorMessage(error);

  function handleExportJson(): void {
    if (!result) return;
    const exportData = buildJsonExport(result, buildPrintableReportMetadata());
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `adyen-inspector-${Date.now()}.json`;
    a.click();
    globalThis.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10_000);
  }

  function handleExportPdf(): void {
    if (!result) return;
    exportPdf(result).catch(() => {});
  }

  function renderTab(): JSX.Element | null {
    if (!result) return null;
    if (activeTab === 'Overview') return <OverviewTab result={result} />;
    if (activeTab === 'Best Practices') return <BestPracticesTab result={result} />;
    if (activeTab === 'Security') return <SecurityTab result={result} />;
    if (activeTab === 'Network') return <NetworkTab result={result} />;
    if (activeTab === 'Extracted Config') return <RawConfigTab result={result} />;
    return <SkippedChecksTab result={result} />;
  }

  const sdkNotDetected = result !== null && !result.sdkPresence.detected;
  const showScanButton = !sdkNotDetected;

  let scanButtonText = 'Run Scan';
  if (scanning) {
    scanButtonText = 'Scanning…';
  } else if (result) {
    scanButtonText = 'Re-run Scan';
  }

  let bodyContent: JSX.Element;
  if (result === null) {
    bodyContent = (
      <div class={s('emptyState')}>
        {scanning ? 'Scanning…' : 'Click "Run Scan" to inspect this page.'}
      </div>
    );
  } else if (sdkNotDetected) {
    bodyContent = (
      <div class={s('tabContent')}>
        <div class={s('emptyState')}>{SDK_NOT_DETECTED_MESSAGE}</div>
      </div>
    );
  } else {
    bodyContent = renderTab() ?? <div class={s('tabContent')} />;
  }

  return (
    <div class={s('panelRoot')}>
      <div class={s('toolbar')}>
        {showScanButton && (
          <button class={`btn ${scanning ? '' : 'btnPrimary'}`} onClick={scan} disabled={scanning}>
            {scanButtonText}
          </button>
        )}
        {result && !sdkNotDetected && (
          <>
            <button class="btn" onClick={handleExportJson}>
              Export JSON
            </button>
            <button class="btn" onClick={handleExportPdf}>
              Export PDF
            </button>
          </>
        )}
        <span class={s('toolbarSpacer')} />
        {result && !sdkNotDetected && (
          <span class={s('toolbarScore')}>
            Score: {result.health.score} · {result.health.passing}/{result.health.total} passing
          </span>
        )}
      </div>
      {errorMsg ? <div class={s('errorBanner')}>{errorMsg}</div> : null}
      {!sdkNotDetected && (
        <div class={s('tabBar')}>
          {TABS.map((tab) => {
            const cls = tab === activeTab ? s('tab') + ' ' + s('tabActive') : s('tab');
            return (
              <button
                key={tab}
                class={cls}
                onClick={() => {
                  setActiveTab(tab);
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>
      )}
      {bodyContent}
    </div>
  );
}
