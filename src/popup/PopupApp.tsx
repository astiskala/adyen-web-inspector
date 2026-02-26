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
import {
  MIN_SUPPORTED_MAJOR_VERSION,
  STORAGE_DETECTED_PREFIX,
  STORAGE_VERSION_PREFIX,
} from '~shared/constants';
import { parseVersion } from '~shared/utils';
import { exportPdf } from '~shared/export-pdf';
import { IdentityCard } from './components/IdentityCard';
import { HealthScore } from './components/HealthScore';
import { IssueList } from './components/IssueList';
import { NotDetected } from './components/NotDetected';
import { DetectedReady } from './components/DetectedReady';
import { VersionOutdated } from './components/VersionOutdated';

type PopupState = 'loading' | 'ready' | 'detected' | 'not-detected' | 'error' | 'version-outdated';
interface RuntimeMessage {
  readonly type: string;
  readonly tabId?: number;
  readonly error?: string;
}

function getActiveTabId(): Promise<number | undefined> {
  return chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]?.id);
}

/**
 * Popup root that loads scan state for the active tab and handles scan actions.
 */
export function Popup(): JSX.Element {
  const [state, setState] = useState<PopupState>('loading');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [outdatedVersion, setOutdatedVersion] = useState<string>('');

  function checkVersionGate(tabId: number): void {
    const versionKey = `${STORAGE_VERSION_PREFIX}${tabId}`;
    chrome.storage.session
      .get(versionKey)
      .then((stored: Record<string, unknown>) => {
        const version = stored[versionKey];
        if (typeof version === 'string') {
          const parsed = parseVersion(version);
          if (parsed && parsed.major < MIN_SUPPORTED_MAJOR_VERSION) {
            setOutdatedVersion(version);
            setState('version-outdated');
            return;
          }
        }
        setState('ready');
      })
      .catch(() => {
        setState('ready');
      });
  }

  function loadResult(tabId: number): void {
    chrome.runtime
      .sendMessage({ type: MSG_GET_RESULT, tabId })
      .then((res: unknown) => {
        if (typeof res === 'object' && res !== null && 'checks' in res) {
          setResult(res as ScanResult);
          setState('detected');
        } else {
          setResult(null);
          const detectedKey = `${STORAGE_DETECTED_PREFIX}${tabId}`;
          chrome.storage.session
            .get(detectedKey)
            .then((stored: Record<string, unknown>) => {
              if (stored[detectedKey] === true) {
                checkVersionGate(tabId);
              } else {
                setState('not-detected');
              }
            })
            .catch(() => {
              setState('not-detected');
            });
        }
      })
      .catch(() => {
        setResult(null);
        setState('not-detected');
      });
  }

  useEffect(() => {
    getActiveTabId()
      .then((tabId) => {
        if (tabId === undefined) {
          setState('not-detected');
          return;
        }
        loadResult(tabId);
      })
      .catch(() => {
        setState('not-detected');
      });

    const listener = (message: RuntimeMessage): void => {
      if (
        message.type !== MSG_SCAN_STARTED &&
        message.type !== MSG_SCAN_COMPLETE &&
        message.type !== MSG_SCAN_ERROR &&
        message.type !== MSG_SCAN_RESET
      ) {
        return;
      }

      getActiveTabId()
        .then((tabId) => {
          if (tabId === undefined || message.tabId !== tabId) {
            return;
          }

          if (message.type === MSG_SCAN_STARTED) {
            setScanning(true);
            return;
          }

          if (message.type === MSG_SCAN_RESET) {
            setScanning(false);
            setResult(null);
            setErrorMsg('');
            setOutdatedVersion('');
            setState('loading');
            globalThis.setTimeout(() => {
              loadResult(tabId);
            }, 400);
            return;
          }

          if (message.type === MSG_SCAN_COMPLETE) {
            setScanning(false);
            setErrorMsg('');
            loadResult(tabId);
            return;
          }

          setScanning(false);
          setState('error');
          setErrorMsg(message.error ?? 'Scan failed. Try reloading the page.');
        })
        .catch(() => {});
    };

    chrome.runtime.onMessage.addListener(listener);
    return (): void => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  function handleScan(): void {
    setErrorMsg('');
    setScanning(true);
    getActiveTabId()
      .then((tabId) => {
        if (tabId === undefined) {
          setScanning(false);
          setState('error');
          setErrorMsg('No active tab found.');
          return;
        }

        chrome.runtime.sendMessage({ type: MSG_SCAN_REQUEST, tabId, source: 'popup' }).catch(() => {
          setScanning(false);
          setState('error');
          setErrorMsg('Unable to start scan. Try reloading the page.');
        });
      })
      .catch(() => {
        setScanning(false);
        setState('error');
        setErrorMsg('Unable to start scan. Try reloading the page.');
      });
  }

  function handleExportPdf(): void {
    if (!result) return;
    exportPdf(result);
  }

  const isDetected = state === 'detected' && result !== null;
  const sdkDetectedCheck =
    result === null ? undefined : result.checks.find((check) => check.id === 'sdk-detected');
  const sdkNotDetected = isDetected && sdkDetectedCheck?.severity === 'fail';
  const sdkNotDetectedMessage =
    sdkDetectedCheck?.title ?? 'Adyen Web SDK was not detected on this page.';
  const showScanControls =
    (state === 'ready' || state === 'detected' || state === 'error') && !sdkNotDetected;
  let scanButtonText = 'Run Scan';
  if (scanning) {
    scanButtonText = 'Scanning…';
  } else if (result) {
    scanButtonText = 'Re-run Scan';
  }

  return (
    <div>
      {state === 'loading' && (
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            color: 'var(--color-text-secondary)',
            fontSize: '12px',
          }}
        >
          Loading…
        </div>
      )}
      {state === 'error' && (
        <div
          style={{
            padding: '16px 12px',
            color: 'var(--color-red)',
            fontSize: '12px',
          }}
        >
          {errorMsg}
        </div>
      )}
      {state === 'ready' && <DetectedReady />}
      {state === 'not-detected' && <NotDetected />}
      {state === 'version-outdated' && <VersionOutdated version={outdatedVersion} />}
      {isDetected && !sdkNotDetected && (
        <>
          <IdentityCard result={result} />
          <HealthScore result={result} />
          <IssueList checks={result.checks} />
        </>
      )}
      {sdkNotDetected && (
        <div
          style={{
            padding: '24px 12px',
            textAlign: 'center',
            color: 'var(--color-text)',
            fontSize: '13px',
            lineHeight: '1.5',
          }}
        >
          {sdkNotDetectedMessage}
        </div>
      )}
      {showScanControls && (
        <div
          style={{
            display: 'flex',
            gap: '6px',
            padding: '8px 12px',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          <button
            class={`btn ${scanning ? '' : 'btnPrimary'}`}
            onClick={handleScan}
            disabled={scanning}
            style={{ flex: 1 }}
          >
            {scanButtonText}
          </button>
          {isDetected && (
            <button class="btn" onClick={handleExportPdf} title="Export PDF report">
              Export PDF
            </button>
          )}
        </div>
      )}
    </div>
  );
}
