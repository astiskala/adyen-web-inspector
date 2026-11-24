import type { JSX, Ref } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { MIN_SUPPORTED_VERSION } from '../shared/constants.js';
import { formatScannedAt } from '../shared/export-metadata.js';
import { openReport } from '../shared/report-export.js';
import type { ScanResult } from '../shared/types.js';
import { meetsMinimumVersion } from '../shared/version-utilities.js';
import { chromeReportBrowser } from './components/chrome-report-browser.js';
import { IdentityCard } from './components/IdentityCard.js';
import { HealthScore } from './components/HealthScore.js';
import { IssueList } from './components/IssueList.js';
import { EmptyState } from './components/EmptyState.js';
import { InspectorBrand } from './components/InspectorBrand.js';
import { InspectorIcon } from './components/InspectorIcon.js';
import { VersionOutdated } from './components/VersionOutdated.js';
import { StandardComplianceBadge } from './components/StandardComplianceBadge.js';
import { chromeTabStateClient } from './components/chrome-tab-state-client.js';
import { type ScanLifecycle, useScanLifecycle } from './components/useScanLifecycle.js';
import { useTheme } from './components/useTheme.js';
import { Settings } from './Settings.js';
import styles from './PopupApp.module.css';
import { cssModule } from './components/css-module.js';

const s = cssModule(styles);
const DETAIL_KEY = 'inspector-detail';

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

const activeTab = { getTabId: getActiveTabId } as const;

function ScanState({
  session,
  scanButton,
}: {
  readonly session: ScanLifecycle;
  readonly scanButton: Ref<HTMLButtonElement>;
}): JSX.Element {
  const { loading, scanning, error, checkoutActivity, scan } = session;
  const { detected, version } = checkoutActivity;
  if (loading) return <EmptyState icon="spinner" title="Loading…" />;
  const action = { onScan: scan, buttonRef: scanButton };
  if (scanning) {
    return (
      <EmptyState
        icon="spinner"
        title="Scanning this page"
        scanAction={{ ...action, label: 'Scanning…', scanning }}
      >
        Checking your Adyen Web implementation and security settings.
      </EmptyState>
    );
  }
  if (error !== null) {
    return (
      <EmptyState
        icon="fail"
        tone="fail"
        title="Scan failed"
        scanAction={{ ...action, label: 'Try again' }}
      >
        Something went wrong while scanning this page. Try reloading the page and scanning again.
      </EmptyState>
    );
  }
  if (!detected || session.result !== null) {
    return (
      <EmptyState
        icon="search"
        title="Adyen not detected"
        scanAction={{ ...action, label: 'Attempt scan', hint: 'Scan anyway?' }}
      >
        No Adyen Web checkout was found on this page.
      </EmptyState>
    );
  }
  if (version !== undefined && meetsMinimumVersion(version, MIN_SUPPORTED_VERSION) === 'unmet') {
    return <VersionOutdated version={version} />;
  }

  return (
    <EmptyState
      icon="pass"
      tone="pass"
      title="Adyen Web SDK detected"
      scanAction={{ ...action, label: 'Run scan' }}
    >
      Run a scan to inspect implementation quality and security checks.
    </EmptyState>
  );
}

function ResultView({
  result,
  scan,
  scanButton,
  detailed,
}: {
  readonly result: ScanResult;
  readonly scan: () => void;
  readonly scanButton: Ref<HTMLButtonElement>;
  readonly detailed: boolean;
}): JSX.Element {
  const [reportFailed, setReportFailed] = useState(false);

  function showReport(): void {
    setReportFailed(false);
    void openReport(result, chromeReportBrowser).catch(() => {
      setReportFailed(true);
    });
  }

  return (
    <>
      <div class={s('content')}>
        <HealthScore result={result} detailed={detailed} />
        <StandardComplianceBadge compliance={result.standardCompliance} detailed={detailed} />
        <IssueList key={result.scannedAt} checks={result.checks} detailed={detailed} />
        {detailed && (
          <>
            <IdentityCard result={result} />
            <p class={s('caption')}>
              Scanned <time dateTime={result.scannedAt}>{formatScannedAt(result.scannedAt)}</time>
            </p>
          </>
        )}
      </div>
      <footer class={s('footer')}>
        {reportFailed && <p role="alert">Could not open the report. Try again.</p>}
        <div class={s('actions')}>
          <button class="btn" ref={scanButton} onClick={scan}>
            <InspectorIcon name="retry" /> Re-run scan
          </button>
          <button class="btn btnPrimary" onClick={showReport}>
            Open full report <InspectorIcon name="external" />
          </button>
        </div>
      </footer>
    </>
  );
}

/**
Popup root for the scan and settings views.
*/
export function Popup(): JSX.Element {
  const session = useScanLifecycle(activeTab, chromeTabStateClient);
  const { result, scan, scanning, error } = session;
  const hasResult = result?.sdkPresence.detected === true && !scanning && error === null;
  const { theme, setTheme } = useTheme();
  const [detailed, updateDetail] = useState(
    () => globalThis.localStorage.getItem(DETAIL_KEY) === 'detailed'
  );
  const [view, setView] = useState<'settings' | 'scan' | null>(null);
  const headerButton = useRef<HTMLButtonElement>(null);
  const scanButton = useRef<HTMLButtonElement>(null);
  const scanStarted = useRef(false);

  useLayoutEffect(() => {
    if (view !== null) headerButton.current?.focus();
  }, [view]);

  useLayoutEffect(() => {
    if (scanning || !scanStarted.current) return;
    scanStarted.current = false;
    // The scan replaces the view, and the button that started it, so focus falls back to the page.
    if (document.activeElement === document.body) scanButton.current?.focus();
  }, [scanning]);

  function startScan(): void {
    scanStarted.current = true;
    scan();
  }

  function setDetailed(isDetailed: boolean): void {
    globalThis.localStorage.setItem(DETAIL_KEY, isDetailed ? 'detailed' : 'essential');
    updateDetail(isDetailed);
  }

  return view === 'settings' ? (
    <Settings
      backButton={headerButton}
      onBack={() => {
        setView('scan');
      }}
      theme={theme}
      onTheme={setTheme}
      detailed={detailed}
      onDetail={setDetailed}
      version={chrome.runtime.getManifest().version}
    />
  ) : (
    <main class={s('popup')}>
      <header class={s('header')}>
        <InspectorBrand />
        <button
          class="btn btnIcon"
          aria-label="Settings"
          ref={headerButton}
          onClick={() => {
            setView('settings');
          }}
        >
          <InspectorIcon name="settings" />
        </button>
      </header>
      {hasResult ? (
        <ResultView result={result} scan={startScan} scanButton={scanButton} detailed={detailed} />
      ) : (
        <ScanState session={{ ...session, scan: startScan }} scanButton={scanButton} />
      )}
    </main>
  );
}
