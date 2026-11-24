import type { JSX, TargetedKeyboardEvent } from 'preact';
import { useState } from 'preact/hooks';
import { chromeTabStateClient } from '../../popup/components/chrome-tab-state-client.js';
import {
  scanButtonLabel,
  useScanLifecycle,
  type ScanLifecycle,
} from '../../popup/components/useScanLifecycle.js';
import { chromeReportBrowser } from '../../popup/components/chrome-report-browser.js';
import { EmptyState } from '../../popup/components/EmptyState.js';
import { InspectorIcon } from '../../popup/components/InspectorIcon.js';
import { HealthTier } from '../../popup/components/HealthScore.js';
import { useTheme } from '../../popup/components/useTheme.js';
import { exportJson, openReport } from '../../shared/report-export.js';
import type { ScanResult } from '../../shared/types.js';
import { describeError } from '../../shared/utilities.js';
import {
  OverviewTab,
  BestPracticesTab,
  SecurityTab,
  NetworkTab,
  RawConfigTab,
  SkippedChecksTab,
} from './tabs.js';
import styles from './panel.module.css';
import { cssModule } from '../../popup/components/css-module.js';

const s = cssModule(styles);

const TABS = [
  'Overview',
  'Best practices',
  'Security',
  'Skipped checks',
  'Network',
  'Extracted config',
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

const inspectedTab = { getTabId: getInspectedTabId } as const;

function isContextInvalidated(error: unknown): boolean {
  return describeError(error).includes(CONTEXT_INVALIDATED_ERROR_TEXT);
}

function getPanelErrorMessage(error: ScanLifecycle['error']): string {
  if (error === null) return '';
  if (error.kind === 'scan') {
    return error.message === '' ? 'Scan failed. Try reloading the page.' : error.message;
  }
  if (error.kind === 'tab') return RUNTIME_ERROR_UI_MESSAGE;
  if (isContextInvalidated(error.cause)) return CONTEXT_INVALIDATED_UI_MESSAGE;
  return error.kind === 'request'
    ? 'Unable to start scan. Try reloading the page.'
    : RUNTIME_ERROR_UI_MESSAGE;
}

const TAB_KEYS: Readonly<Record<string, (index: number) => number>> = {
  ArrowRight: (index) => (index + 1) % TABS.length,
  ArrowLeft: (index) => (index - 1 + TABS.length) % TABS.length,
  Home: () => 0,
  End: () => TABS.length - 1,
};

function tabId(tab: TabName): string {
  return `tab-${tab.toLowerCase().replaceAll(' ', '-')}`;
}

/**
The tab an arrow, Home, or End key moves to from the active tab, as in the WAI-ARIA tabs pattern.
*/
function tabForKey(activeTab: TabName, key: string): TabName | undefined {
  const move = TAB_KEYS[key];
  return move === undefined ? undefined : TABS[move(TABS.indexOf(activeTab))];
}

function renderTab(activeTab: TabName, result: ScanResult): JSX.Element {
  if (activeTab === 'Overview') return <OverviewTab result={result} />;
  if (activeTab === 'Best practices') return <BestPracticesTab result={result} />;
  if (activeTab === 'Security') return <SecurityTab result={result} />;
  if (activeTab === 'Network') return <NetworkTab result={result} />;
  return activeTab === 'Extracted config' ? (
    <RawConfigTab result={result} />
  ) : (
    <SkippedChecksTab result={result} />
  );
}

function PanelState({
  session,
  message,
}: {
  readonly session: ScanLifecycle;
  readonly message: string;
}): JSX.Element {
  const { loading, scanning, error, checkoutActivity, result, scan } = session;
  if (loading) return <EmptyState icon="spinner" title="Loading…" />;
  if (scanning) {
    return (
      <EmptyState icon="spinner" title="Scanning this page…">
        This usually takes a few seconds.
      </EmptyState>
    );
  }
  if (error !== null) {
    return (
      <EmptyState
        icon="fail"
        tone="fail"
        title="Scan failed"
        scanAction={{ label: 'Try again', onScan: scan }}
      >
        {message}
      </EmptyState>
    );
  }
  if (result === null && checkoutActivity.detected) {
    return (
      <EmptyState
        icon="pass"
        tone="pass"
        title="Adyen Web SDK detected"
        scanAction={{ label: 'Run scan', onScan: scan }}
      >
        Run a scan to inspect this page.
      </EmptyState>
    );
  }

  return (
    <EmptyState
      icon="search"
      title="Adyen not detected"
      scanAction={{ label: 'Attempt scan', hint: 'Scan anyway?', onScan: scan }}
    >
      {SDK_NOT_DETECTED_MESSAGE}
    </EmptyState>
  );
}

/**
DevTools panel root that coordinates scan lifecycle, exports, and tab views.
*/
export function Panel(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabName>('Overview');
  const [reportFailed, setReportFailed] = useState(false);
  useTheme();
  const session = useScanLifecycle(inspectedTab, chromeTabStateClient);
  const { result, scanning, error, scan } = session;
  const isAvailable = result?.sdkPresence.detected === true && !scanning && error === null;
  const scanIcon = isAvailable ? 'retry' : 'scan';

  function selectTabByKey(event: TargetedKeyboardEvent<HTMLDivElement>): void {
    const next = tabForKey(activeTab, event.key);
    if (next === undefined) return;
    event.preventDefault();
    setActiveTab(next);
    event.currentTarget.querySelector<HTMLElement>(`#${tabId(next)}`)?.focus();
  }

  function reportAction(mode: 'view' | 'print'): (() => void) | undefined {
    if (!isAvailable) return undefined;
    return () => {
      setReportFailed(false);
      void openReport(result, chromeReportBrowser, mode).catch(() => {
        setReportFailed(true);
      });
    };
  }

  return (
    <main class={s('panelRoot')}>
      <div class={s('toolbar')}>
        <button class="btn btnPrimary" onClick={scan} disabled={scanning}>
          <InspectorIcon name={scanning ? 'spinner' : scanIcon} />
          {scanButtonLabel({ scanning, result: isAvailable ? result : null })}
        </button>
        <button class="btn" onClick={reportAction('view')} disabled={!isAvailable}>
          Open full report <InspectorIcon name="external" />
        </button>
        <button
          class="btn"
          onClick={
            isAvailable
              ? (): void => {
                  exportJson(result, chromeReportBrowser);
                }
              : undefined
          }
          disabled={!isAvailable}
        >
          <InspectorIcon name="download" /> Export JSON
        </button>
        <button class="btn" onClick={reportAction('print')} disabled={!isAvailable}>
          <InspectorIcon name="download" /> Export PDF
        </button>
        {isAvailable && (
          <div class={s('toolbarScore')}>
            <HealthTier tier={result.health.tier} />
            <span>
              Score: {result.health.score} · {result.health.passing}/{result.health.total} passing
            </span>
          </div>
        )}
      </div>
      {reportFailed && (
        <p class={s('errorBanner')} data-tone="fail" role="alert">
          Could not open the report. Try again.
        </p>
      )}
      <div
        class={s('tabBar')}
        role="tablist"
        aria-label="Scan result sections"
        onKeyDown={selectTabByKey}
      >
        {TABS.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <button
              key={tab}
              id={tabId(tab)}
              role="tab"
              aria-selected={isActive}
              aria-controls="tab-panel"
              tabIndex={isActive ? 0 : -1}
              class={isActive ? `${s('tab')} ${s('tabActive')}` : s('tab')}
              onClick={() => {
                setActiveTab(tab);
              }}
            >
              {tab}
            </button>
          );
        })}
      </div>
      <div
        key={activeTab}
        class={s('tabPanel')}
        role="tabpanel"
        id="tab-panel"
        tabIndex={0}
        aria-labelledby={tabId(activeTab)}
      >
        {isAvailable ? (
          renderTab(activeTab, result)
        ) : (
          <PanelState session={session} message={getPanelErrorMessage(error)} />
        )}
      </div>
    </main>
  );
}
