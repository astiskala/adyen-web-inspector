import type { JSX } from 'preact';
import { MIN_SUPPORTED_MAJOR_VERSION } from '../shared/constants.js';
import type { CheckoutActivity } from '../shared/messages.js';
import { parseVersion } from '../shared/utils.js';
import { exportPdf } from './components/pdf-export.js';
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

function getActiveTabId(): Promise<number | undefined> {
  return chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]?.id);
}

const popupTabAdapter = { getTabId: getActiveTabId, resetDelayMs: 400 } as const;

type PopupView =
  | { readonly state: 'loading' | 'error' | 'detected' | 'ready' | 'not-detected' }
  | { readonly state: 'version-outdated'; readonly version: string };

/** Resolves the view for a tab without a scan result from the detector's checkout activity. */
function getIdleView({ detected, version }: CheckoutActivity): PopupView {
  if (!detected) return { state: 'not-detected' };
  const major = parseVersion(version ?? '')?.major;
  if (version !== undefined && major !== undefined && major < MIN_SUPPORTED_MAJOR_VERSION) {
    return { state: 'version-outdated', version };
  }
  return { state: 'ready' };
}

function getPopupView(session: ReturnType<typeof useScanLifecycle>): PopupView {
  if (session.loading && session.result === null) return { state: 'loading' };
  if (session.error !== null) return { state: 'error' };
  if (session.result !== null) return { state: 'detected' };
  return getIdleView(session.checkoutActivity);
}

/**
 * Popup root that loads scan state for the active tab and handles scan actions.
 */
export function Popup(): JSX.Element {
  const session = useScanLifecycle(popupTabAdapter);
  const { result, scanning, scan } = session;
  const view = getPopupView(session);
  const { state } = view;

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
      {view.state === 'version-outdated' && <VersionOutdated version={view.version} />}
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
