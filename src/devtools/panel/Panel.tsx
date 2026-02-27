import type { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { ScanResult } from '~shared/types';
import {
  MSG_GET_RESULT,
  MSG_SCAN_COMPLETE,
  MSG_SCAN_ERROR,
  MSG_SCAN_REQUEST,
  MSG_SCAN_RESET,
  MSG_SCAN_STARTED,
} from '~shared/messages';
import { buildIssueExportRows } from '~shared/utils';
import { exportPdf } from '~shared/export-pdf';
import {
  OverviewTab,
  BestPracticesTab,
  SecurityTab,
  NetworkTab,
  RawConfigTab,
  SkippedChecksTab,
} from './tabs';
import styles from './panel.module.css';

const s = (key: string): string => styles[key] ?? '';

const TABS = [
  'Overview',
  'Best Practices',
  'Security',
  'Skipped Checks',
  'Network',
  'Raw Config',
] as const;
type TabName = (typeof TABS)[number];
const CONTEXT_INVALIDATED_ERROR_TEXT = 'Extension context invalidated';
const CONTEXT_INVALIDATED_UI_MESSAGE =
  'Extension context is invalidated. Reload the extension and reopen the Adyen Inspector panel.';
const RUNTIME_ERROR_UI_MESSAGE = 'Unable to communicate with the extension runtime.';

interface RuntimeMessage {
  readonly type: string;
  readonly tabId?: number;
  readonly error?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object' && error !== null) {
    try {
      const serialized = JSON.stringify(error);
      if (typeof serialized === 'string') {
        return serialized;
      }
    } catch {
      // Ignore serialization issues and fall back to object tag.
    }
    return Object.prototype.toString.call(error);
  }
  if (error === undefined) {
    return 'undefined';
  }
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return `${error}`;
  }
  if (typeof error === 'symbol') {
    return error.description ?? 'Symbol';
  }
  if (typeof error === 'function') {
    return error.name === '' ? '[function]' : `[function ${error.name}]`;
  }
  return 'Unknown runtime error';
}

function isContextInvalidated(error: unknown): boolean {
  return getErrorMessage(error).includes(CONTEXT_INVALIDATED_ERROR_TEXT);
}

/**
 * DevTools panel root that coordinates scan lifecycle, exports, and tab views.
 */
export function Panel(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabName>('Overview');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  function handleRuntimeError(error: unknown, fallbackMessage: string): void {
    setScanning(false);
    if (isContextInvalidated(error)) {
      setErrorMsg(CONTEXT_INVALIDATED_UI_MESSAGE);
      return;
    }
    setErrorMsg(fallbackMessage);
  }

  function getInspectedTabIdSafe(): number | null {
    try {
      return chrome.devtools.inspectedWindow.tabId;
    } catch (error) {
      handleRuntimeError(error, RUNTIME_ERROR_UI_MESSAGE);
      return null;
    }
  }

  function sendRuntimeMessageSafe(message: object): Promise<unknown> | null {
    try {
      return chrome.runtime.sendMessage(message);
    } catch (error) {
      handleRuntimeError(error, RUNTIME_ERROR_UI_MESSAGE);
      return null;
    }
  }

  function loadResult(): void {
    const tabId = getInspectedTabIdSafe();
    if (tabId === null) {
      return;
    }

    const request = sendRuntimeMessageSafe({ type: MSG_GET_RESULT, tabId });
    if (request === null) {
      return;
    }

    request
      .then((res: unknown) => {
        if (typeof res === 'object' && res !== null && 'checks' in res) {
          setResult(res as ScanResult);
          setErrorMsg('');
          return;
        }
        setResult(null);
      })
      .catch((error: unknown) => {
        handleRuntimeError(error, RUNTIME_ERROR_UI_MESSAGE);
      });
  }

  useEffect(() => {
    loadResult();

    const listener = (message: RuntimeMessage): void => {
      const tabId = getInspectedTabIdSafe();
      if (tabId === null || message.tabId !== tabId) {
        return;
      }

      if (message.type === MSG_SCAN_STARTED) {
        setErrorMsg('');
        setScanning(true);
        return;
      }

      if (message.type === MSG_SCAN_RESET) {
        setScanning(false);
        setErrorMsg('');
        setResult(null);
        return;
      }

      if (message.type === MSG_SCAN_COMPLETE) {
        setScanning(false);
        loadResult();
        return;
      }

      if (message.type === MSG_SCAN_ERROR) {
        setScanning(false);
        setErrorMsg(message.error ?? 'Scan failed. Try reloading the page.');
      }
    };

    try {
      chrome.runtime.onMessage.addListener(listener);
    } catch (error) {
      handleRuntimeError(error, RUNTIME_ERROR_UI_MESSAGE);
    }

    return (): void => {
      try {
        chrome.runtime.onMessage.removeListener(listener);
      } catch {
        // Context can be invalidated while unmounting.
      }
    };
  }, []);

  function handleScan(): void {
    setErrorMsg('');
    setScanning(true);
    const tabId = getInspectedTabIdSafe();
    if (tabId === null) {
      return;
    }

    const request = sendRuntimeMessageSafe({ type: MSG_SCAN_REQUEST, tabId, source: 'devtools' });
    if (request === null) {
      return;
    }

    request.catch((error: unknown) => {
      handleRuntimeError(error, 'Unable to start scan. Try reloading the page.');
    });
  }

  function handleExportJson(): void {
    if (!result) return;
    const exportData = {
      exportedAt: new Date().toISOString(),
      summary: {
        pageUrl: result.pageUrl,
        scannedAt: result.scannedAt,
        health: result.health,
      },
      issues: buildIssueExportRows(result.checks),
      scanResult: result,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `adyen-inspector-${Date.now()}.json`;
    a.click();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function handleExportPdf(): void {
    if (!result) return;
    exportPdf(result);
  }

  function renderTab(): JSX.Element | null {
    if (!result) return null;
    if (activeTab === 'Overview') return <OverviewTab result={result} />;
    if (activeTab === 'Best Practices') return <BestPracticesTab result={result} />;
    if (activeTab === 'Security') return <SecurityTab result={result} />;
    if (activeTab === 'Network') return <NetworkTab result={result} />;
    if (activeTab === 'Raw Config') return <RawConfigTab result={result} />;
    return <SkippedChecksTab result={result} />;
  }

  const sdkDetectedCheck =
    result === null ? undefined : result.checks.find((check) => check.id === 'sdk-detected');
  const sdkNotDetected = result !== null && sdkDetectedCheck?.severity === 'fail';
  const sdkNotDetectedMessage =
    sdkDetectedCheck?.title ?? 'Adyen Web SDK was not detected on this page.';
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
        <div class={s('emptyState')}>{sdkNotDetectedMessage}</div>
      </div>
    );
  } else {
    bodyContent = renderTab() ?? <div class={s('tabContent')} />;
  }

  return (
    <div class={s('panelRoot')}>
      <div class={s('toolbar')}>
        {showScanButton && (
          <button
            class={`btn ${scanning ? '' : 'btnPrimary'}`}
            onClick={handleScan}
            disabled={scanning}
          >
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
          <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
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
