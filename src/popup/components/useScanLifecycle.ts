import { useEffect, useRef, useState } from 'preact/hooks';
import {
  EMPTY_TAB_SNAPSHOT,
  type CheckoutActivity,
  type TabSnapshot,
} from '../../shared/messages.js';
import type { ScanResult } from '../../shared/types.js';

/**
 * What the popup and DevTools panel need from the tab state. Chrome runtime
 * messaging is the production adapter; tests connect the real tab state.
 */
export interface TabStateClient {
  /** Reads the tab's snapshot; rejects when the extension runtime is unreachable. */
  read(tabId: number): Promise<TabSnapshot>;
  /** Asks the tab state to scan the tab; rejects when the request cannot be sent. */
  requestScan(tabId: number): Promise<void>;
  /** Delivers every snapshot the tab state publishes; returns an unsubscribe function. */
  subscribe(listener: (tabId: number, snapshot: TabSnapshot) => void): () => void;
}

/** Which tab a view inspects. */
interface TabTarget {
  getTabId(): number | undefined | Promise<number | undefined>;
}

type ScanFailure =
  | { readonly kind: 'scan'; readonly message: string }
  | { readonly kind: 'runtime' | 'request'; readonly cause: unknown }
  | { readonly kind: 'tab' };

interface ScanState {
  readonly result: ScanResult | null;
  readonly checkoutActivity: CheckoutActivity;
  readonly scanning: boolean;
  readonly loading: boolean;
  readonly error: ScanFailure | null;
}

const INITIAL_STATE: ScanState = {
  result: null,
  checkoutActivity: EMPTY_TAB_SNAPSHOT.checkoutActivity,
  scanning: false,
  loading: true,
  error: null,
};

function fromSnapshot({ result, checkoutActivity, scan }: TabSnapshot): ScanState {
  return {
    result,
    checkoutActivity,
    scanning: scan.state === 'running',
    loading: false,
    error: scan.state === 'failed' ? { kind: 'scan', message: scan.error } : null,
  };
}

function failed(error: ScanFailure): (previous: ScanState) => ScanState {
  return (previous) => ({ ...previous, scanning: false, loading: false, error });
}

/**
 * Renders one tab's snapshot as the tab state publishes it, and exposes a
 * scan trigger shared by the popup and DevTools panel.
 */
export function useScanLifecycle(
  target: TabTarget,
  client: TabStateClient
): ScanState & { readonly scan: () => void } {
  const [state, setState] = useState<ScanState>(INITIAL_STATE);
  const tabId = useRef<Promise<number | undefined> | null>(null);
  const mounted = useRef(false);

  function update(next: ScanState | ((previous: ScanState) => ScanState)): void {
    if (mounted.current) setState(next);
  }

  useEffect(() => {
    mounted.current = true;
    let unsubscribe = (): void => {};
    const resolved = Promise.resolve().then(() => target.getTabId());
    tabId.current = resolved;

    async function follow(): Promise<void> {
      const id = await resolved;
      if (!mounted.current) return;
      if (id === undefined) {
        update(fromSnapshot(EMPTY_TAB_SNAPSHOT));
        return;
      }
      unsubscribe = client.subscribe((changedTabId, snapshot) => {
        if (changedTabId === id) update(fromSnapshot(snapshot));
      });
      update(fromSnapshot(await client.read(id)));
    }

    follow().catch((error: unknown) => {
      update(failed({ kind: 'runtime', cause: error }));
    });
    return (): void => {
      mounted.current = false;
      unsubscribe();
    };
  }, [target, client]);

  async function requestScan(): Promise<void> {
    let id: number | undefined;
    try {
      id = await (tabId.current ?? target.getTabId());
    } catch (error: unknown) {
      update(failed({ kind: 'runtime', cause: error }));
      return;
    }
    if (id === undefined) {
      update(failed({ kind: 'tab' }));
      return;
    }
    try {
      await client.requestScan(id);
    } catch (error: unknown) {
      update(failed({ kind: 'request', cause: error }));
    }
  }

  function scan(): void {
    update((previous) => ({ ...previous, scanning: true, loading: false, error: null }));
    requestScan().catch(() => {});
  }

  return { ...state, scan };
}
