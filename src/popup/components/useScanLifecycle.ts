import { useEffect, useRef, useState } from 'preact/hooks';
import {
  MSG_GET_RESULT,
  MSG_SCAN_COMPLETE,
  MSG_SCAN_ERROR,
  MSG_SCAN_REQUEST,
  MSG_SCAN_RESET,
  MSG_SCAN_STARTED,
  type BswToUiMessage,
  type ScanRequestSource,
} from '../../shared/messages.js';
import type { ScanResult } from '../../shared/types.js';
import { isScanResult } from '../../shared/utils.js';

type ScanFailure =
  | { readonly kind: 'scan'; readonly message?: string }
  | { readonly kind: 'runtime' | 'request'; readonly cause: unknown }
  | { readonly kind: 'tab' };

interface TabAdapter {
  readonly source: ScanRequestSource;
  getTabId(): number | undefined | Promise<number | undefined>;
  readonly resetDelayMs?: number;
}

interface ScanState {
  readonly result: ScanResult | null;
  readonly scanning: boolean;
  readonly loading: boolean;
  readonly error: ScanFailure | null;
}

const INITIAL_STATE: ScanState = { result: null, scanning: false, loading: true, error: null };

const SCAN_LIFECYCLE_TYPES: ReadonlySet<string> = new Set([
  MSG_SCAN_STARTED,
  MSG_SCAN_COMPLETE,
  MSG_SCAN_ERROR,
  MSG_SCAN_RESET,
]);

function isScanLifecycleMessage(message: { readonly type: string }): message is BswToUiMessage {
  return SCAN_LIFECYCLE_TYPES.has(message.type);
}

export const useScanLifecycle = (adapter: TabAdapter): ScanState & { scan(): void } => {
  const [state, setState] = useState<ScanState>(INITIAL_STATE);
  const generation = useRef(0);
  const mounted = useRef(false);

  async function loadResult(): Promise<void> {
    const current = ++generation.current;
    setState((previous) => ({ ...previous, loading: true }));
    try {
      const tabId = await adapter.getTabId();
      const result: unknown =
        tabId === undefined
          ? null
          : await chrome.runtime.sendMessage({ type: MSG_GET_RESULT, tabId });
      if (mounted.current && current === generation.current) {
        setState({
          result: isScanResult(result) ? result : null,
          scanning: false,
          loading: false,
          error: null,
        });
      }
    } catch (cause) {
      if (mounted.current && current === generation.current) {
        setState((previous) => ({
          ...previous,
          scanning: false,
          loading: false,
          error: { kind: 'runtime', cause },
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
      } catch (cause) {
        if (mounted.current && current === generation.current) {
          setState((previous) => ({
            ...previous,
            scanning: false,
            error: { kind: 'runtime', cause },
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
        await chrome.runtime.sendMessage({ type: MSG_SCAN_REQUEST, tabId, source: adapter.source });
      } catch (cause) {
        if (mounted.current && current === generation.current) {
          setState((previous) => ({
            ...previous,
            scanning: false,
            error: { kind: 'request', cause },
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
      } catch (cause) {
        if (!mounted.current) return;
        setState((previous) => ({
          ...previous,
          scanning: false,
          error: { kind: 'runtime', cause },
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
          result: null,
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
};
