import { useEffect, useRef, useState } from 'preact/hooks';
import {
  MSG_GET_TAB_STATE,
  MSG_SCAN_COMPLETE,
  MSG_SCAN_ERROR,
  MSG_SCAN_REQUEST,
  MSG_SCAN_RESET,
  MSG_SCAN_STARTED,
  type BswToUiMessage,
  type CheckoutActivity,
  type TabSnapshot,
} from '../../shared/messages.js';
import type { ScanResult } from '../../shared/types.js';
import { isRecord, isScanResult } from '../../shared/utils.js';

type ScanFailure =
  | { readonly kind: 'scan'; readonly message?: string }
  | { readonly kind: 'runtime' | 'request'; readonly cause: unknown }
  | { readonly kind: 'tab' };

interface TabAdapter {
  getTabId(): number | undefined | Promise<number | undefined>;
  readonly resetDelayMs?: number;
}

interface ScanState {
  readonly result: ScanResult | null;
  readonly checkoutActivity: CheckoutActivity;
  readonly scanning: boolean;
  readonly loading: boolean;
  readonly error: ScanFailure | null;
}

const EMPTY_SNAPSHOT: TabSnapshot = { result: null, checkoutActivity: { detected: false } };

const INITIAL_STATE: ScanState = {
  ...EMPTY_SNAPSHOT,
  scanning: false,
  loading: true,
  error: null,
};

/** Reads the worker's tab snapshot, tolerating a missing or malformed response. */
function readSnapshot(value: unknown): TabSnapshot {
  if (!isRecord(value)) return EMPTY_SNAPSHOT;
  const { result, checkoutActivity: activity } = value;
  const version = isRecord(activity) ? activity['version'] : undefined;
  const detected = isRecord(activity) && activity['detected'] === true;
  return {
    result: isScanResult(result) ? result : null,
    checkoutActivity:
      detected && typeof version === 'string' ? { detected, version } : { detected },
  };
}

const SCAN_LIFECYCLE_TYPES: ReadonlySet<string> = new Set([
  MSG_SCAN_STARTED,
  MSG_SCAN_COMPLETE,
  MSG_SCAN_ERROR,
  MSG_SCAN_RESET,
]);

function isScanLifecycleMessage(message: { readonly type: string }): message is BswToUiMessage {
  return SCAN_LIFECYCLE_TYPES.has(message.type);
}

/**
 * Tracks one tab's state (its scan result and checkout activity) and scan
 * progress, and exposes a scan trigger shared by the popup and DevTools panel.
 */
export function useScanLifecycle(adapter: TabAdapter): ScanState & { readonly scan: () => void } {
  const [state, setState] = useState<ScanState>(INITIAL_STATE);
  const generation = useRef(0);
  const mounted = useRef(false);

  async function loadResult(): Promise<void> {
    const current = ++generation.current;
    setState((previous) => ({ ...previous, loading: true }));
    try {
      const tabId = await adapter.getTabId();
      const snapshot: unknown =
        tabId === undefined
          ? null
          : await chrome.runtime.sendMessage({ type: MSG_GET_TAB_STATE, tabId });
      if (mounted.current && current === generation.current) {
        setState({ ...readSnapshot(snapshot), scanning: false, loading: false, error: null });
      }
    } catch (error) {
      if (mounted.current && current === generation.current) {
        setState((previous) => ({
          ...previous,
          scanning: false,
          loading: false,
          error: { kind: 'runtime', cause: error },
        }));
      }
    }
  }

  function reload(): void {
    loadResult().catch(() => {});
  }

  function scan(): void {
    const current = ++generation.current;
    setState((previous) => ({ ...previous, scanning: true, loading: false, error: null }));
    async function requestScan(): Promise<void> {
      let tabId: number | undefined;
      try {
        tabId = await adapter.getTabId();
      } catch (error) {
        if (mounted.current && current === generation.current) {
          setState((previous) => ({
            ...previous,
            scanning: false,
            error: { kind: 'runtime', cause: error },
          }));
        }
        return;
      }
      if (tabId === undefined) {
        if (mounted.current && current === generation.current) {
          setState((previous) => ({ ...previous, scanning: false, error: { kind: 'tab' } }));
        }
        return;
      }

      try {
        // chrome.runtime.sendMessage returns a promise; await handles rejected sends.
        // Synchronous context invalidation also reaches this request error path.
        await chrome.runtime.sendMessage({ type: MSG_SCAN_REQUEST, tabId });
      } catch (error) {
        if (mounted.current && current === generation.current) {
          setState((previous) => ({
            ...previous,
            scanning: false,
            error: { kind: 'request', cause: error },
          }));
        }
      }
    }
    requestScan().catch(() => {});
  }

  useEffect(() => {
    mounted.current = true;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    reload();

    async function handleMessage(message: BswToUiMessage): Promise<void> {
      let tabId: number | undefined;
      try {
        tabId = await adapter.getTabId();
      } catch (error) {
        if (!mounted.current) return;
        setState((previous) => ({
          ...previous,
          scanning: false,
          error: { kind: 'runtime', cause: error },
        }));
        return;
      }
      if (!mounted.current || tabId === undefined || message.tabId !== tabId) return;

      if (resetTimer !== undefined) {
        globalThis.clearTimeout(resetTimer);
        resetTimer = undefined;
      }
      if (message.type === MSG_SCAN_STARTED) {
        ++generation.current;
        setState((previous) => ({ ...previous, scanning: true, loading: false, error: null }));
        return;
      }
      if (message.type === MSG_SCAN_RESET) {
        ++generation.current;
        setState({
          ...EMPTY_SNAPSHOT,
          scanning: false,
          loading: adapter.resetDelayMs !== undefined,
          error: null,
        });
        if (adapter.resetDelayMs !== undefined) {
          resetTimer = globalThis.setTimeout(reload, adapter.resetDelayMs);
        }
        return;
      }
      if (message.type === MSG_SCAN_COMPLETE) {
        reload();
        return;
      }
      ++generation.current;
      setState((previous) => ({
        ...previous,
        scanning: false,
        loading: false,
        error: { kind: 'scan', message: message.error },
      }));
    }

    const listener = (message: { readonly type: string }): void => {
      if (!isScanLifecycleMessage(message)) return;
      handleMessage(message).catch(() => {});
    };
    chrome.runtime.onMessage.addListener(listener);
    return (): void => {
      mounted.current = false;
      ++generation.current;
      if (resetTimer !== undefined) globalThis.clearTimeout(resetTimer);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [adapter]);

  return { ...state, scan };
}
