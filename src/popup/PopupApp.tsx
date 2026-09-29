import type { JSX } from 'preact';
import { MIN_SUPPORTED_MAJOR_VERSION } from '../shared/constants.js';
import type { CheckoutActivity } from '../shared/messages.js';
import type { ScanResult } from '../shared/types.js';
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
import { chromeTabStateClient } from './components/chrome-tab-state-client.js';
import { scanButtonLabel, useScanLifecycle } from './components/useScanLifecycle.js';
import styles from './PopupApp.module.css';
import { cssModule } from './components/css-module.js';

const s = cssModule(styles);

function getActiveTabId(): Promise<number | undefined> {
  return chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]?.id);
}

const activeTab = { getTabId: getActiveTabId } as const;

type PopupView =
  | { readonly state: 'loading' | 'error' | 'ready' | 'not-detected' }
  | { readonly state: 'version-outdated'; readonly version: string }
  | { readonly state: 'result'; readonly result: ScanResult };

/** Resolves the view for a tab without a scan result from the detector's checkout activity. */
function getIdleView({ detected, version }: CheckoutActivity): PopupView {
  if (!detected) return { state: 'not-detected' };
  const major = parseVersion(version ?? '')?.major;
  if (version !== undefined && major !== undefined && major < MIN_SUPPORTED_MAJOR_VERSION) {
    return { state: 'version-outdated', version };
  }
  return { state: 'ready' };
}

/** A scan that found no SDK offers another attempt, like a page where none was detected. */
function getPopupView(session: ReturnType<typeof useScanLifecycle>): PopupView {
  const { loading, error, result, checkoutActivity } = session;
  if (loading && result === null) return { state: 'loading' };
  if (error !== null) return { state: 'error' };
  if (result === null) return getIdleView(checkoutActivity);
  return result.sdkPresence.detected ? { state: 'result', result } : { state: 'not-detected' };
}

/**
 * Popup root that loads scan state for the active tab and handles scan actions.
 */
export function Popup(): JSX.Element {
  const session = useScanLifecycle(activeTab, chromeTabStateClient);
  const { scanning, scan } = session;
  const view = getPopupView(session);

  return (
    <div>
      {view.state === 'loading' && <div class={s('loading')}>Loading…</div>}
      {view.state === 'error' && <ScanError onRetry={scan} scanning={scanning} />}
      {view.state === 'ready' && <DetectedReady />}
      {view.state === 'not-detected' && <NotDetected onAttemptScan={scan} scanning={scanning} />}
      {view.state === 'version-outdated' && <VersionOutdated version={view.version} />}
      {view.state === 'result' && (
        <>
          <IdentityCard result={view.result} />
          <HealthScore result={view.result} />
          <StandardComplianceBadge compliance={view.result.standardCompliance} />
          <IssueList checks={view.result.checks} />
        </>
      )}
      {(view.state === 'ready' || view.state === 'result') && (
        <div class={s('toolbar')}>
          <button
            class={`btn ${scanning ? '' : 'btnPrimary'} ${s('scanButton')}`}
            onClick={scan}
            disabled={scanning}
          >
            {scanButtonLabel(session)}
          </button>
          {view.state === 'result' && (
            <button
              class="btn"
              onClick={() => {
                exportPdf(view.result).catch(() => {});
              }}
              title="Export PDF report"
            >
              Export PDF
            </button>
          )}
        </div>
      )}
    </div>
  );
}
