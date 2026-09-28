import type { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  MIN_SUPPORTED_MAJOR_VERSION,
  STORAGE_CHECKOUT_ACTIVITY_PREFIX,
  STORAGE_VERSION_PREFIX,
} from '../shared/constants.js';
import { parseVersion } from '../shared/utils.js';
import { exportPdf } from '../shared/export-pdf.js';
import { IdentityCard } from './components/IdentityCard.js';
import { HealthScore } from './components/HealthScore.js';
import { IssueList } from './components/IssueList.js';
import { NotDetected } from './components/NotDetected.js';
import { DetectedReady } from './components/DetectedReady.js';
import { VersionOutdated } from './components/VersionOutdated.js';
import { ScanError } from './components/ScanError.js';
import { StandardComplianceBadge } from './components/StandardComplianceBadge.js';
import { useScanLifecycle } from './components/useScanLifecycle.js';
import styles from './PopupApp.module.css';

const s = (key: string): string => styles[key] ?? '';

type PopupState = 'loading' | 'ready' | 'detected' | 'not-detected' | 'error' | 'version-outdated';
function getActiveTabId(): Promise<number | undefined> {
  return chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]?.id);
}

const popupTabAdapter = { getTabId: getActiveTabId, resetDelayMs: 400 } as const;

type IdleView =
  | { readonly state: 'ready' | 'not-detected' }
  | { readonly state: 'version-outdated'; readonly version: string };

/** Resolves the view for a tab without a scan result from the detector's checkout activity flags. */
async function getIdleView(): Promise<IdleView> {
  const tabId = await getActiveTabId();
  if (tabId === undefined) return { state: 'not-detected' };

  const activityKey = `${STORAGE_CHECKOUT_ACTIVITY_PREFIX}${tabId}`;
  const versionKey = `${STORAGE_VERSION_PREFIX}${tabId}`;
  const stored: Record<string, unknown> = await chrome.storage.session.get([
    activityKey,
    versionKey,
  ]);
  if (stored[activityKey] !== true) return { state: 'not-detected' };

  const version = stored[versionKey];
  if (typeof version === 'string') {
    const parsed = parseVersion(version);
    if (parsed && parsed.major < MIN_SUPPORTED_MAJOR_VERSION) {
      return { state: 'version-outdated', version };
    }
  }
  return { state: 'ready' };
}

/**
 * Popup root that loads scan state for the active tab and handles scan actions.
 */
export function Popup(): JSX.Element {
  const [state, setState] = useState<PopupState>('loading');
  const { result, scanning, loading, error, scan } = useScanLifecycle(popupTabAdapter);
  const [outdatedVersion, setOutdatedVersion] = useState<string>('');

  useEffect(() => {
    if (loading) {
      if (result === null) {
        setOutdatedVersion('');
        setState('loading');
      }
      return;
    }
    if (error !== null) {
      setState('error');
      return;
    }
    if (scanning) return;
    if (result !== null) {
      setState('detected');
      return;
    }

    let cancelled = false;
    getIdleView()
      .catch((): IdleView => ({ state: 'not-detected' }))
      .then((view) => {
        if (cancelled) return;
        if (view.state === 'version-outdated') setOutdatedVersion(view.version);
        setState(view.state);
      })
      .catch(() => {});
    return (): void => {
      cancelled = true;
    };
  }, [loading, scanning, result, error]);

  function handleExportPdf(): void {
    if (!result) return;
    exportPdf(result).catch(() => {});
  }

  const isDetected = state === 'detected' && result !== null;
  const sdkNotDetected = isDetected && !result.sdkPresence.detected;
  const showScanControls = (state === 'ready' || state === 'detected') && !sdkNotDetected;
  let scanButtonText = 'Run Scan';
  if (scanning) {
    scanButtonText = 'Scanning…';
  } else if (result) {
    scanButtonText = 'Re-run Scan';
  }

  return (
    <div>
      {state === 'loading' && <div class={s('loading')}>Loading…</div>}
      {state === 'error' && <ScanError onRetry={scan} scanning={scanning} />}
      {state === 'ready' && <DetectedReady />}
      {state === 'not-detected' && <NotDetected onAttemptScan={scan} scanning={scanning} />}
      {state === 'version-outdated' && <VersionOutdated version={outdatedVersion} />}
      {isDetected && !sdkNotDetected && (
        <>
          <IdentityCard result={result} />
          <HealthScore result={result} />
          <StandardComplianceBadge compliance={result.standardCompliance} />
          <IssueList checks={result.checks} />
        </>
      )}
      {sdkNotDetected && <NotDetected onAttemptScan={scan} scanning={scanning} />}
      {showScanControls && (
        <div class={s('toolbar')}>
          <button
            class={`btn ${scanning ? '' : 'btnPrimary'} ${s('scanButton')}`}
            onClick={scan}
            disabled={scanning}
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
