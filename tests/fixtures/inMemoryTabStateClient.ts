import type { createTabState } from '../../src/background/tab-state';
import type { TabStateClient } from '../../src/popup/components/useScanLifecycle';
import type { FakeTabStateBrowser } from './fakeTabStateBrowser';

/**
 * In-memory adapter for the tab state client, connected to a real tab state
 * over the fake browser: reads and scan requests go straight to the tab state,
 * and every snapshot it publishes reaches subscribers, as it would through the
 * worker. Scan requests do not wait for the Scan, matching the worker.
 */
export function connectTabStateClient(
  tabState: ReturnType<typeof createTabState>,
  browser: FakeTabStateBrowser
): TabStateClient {
  return {
    read: (tabId) => tabState.read(tabId),
    requestScan: async (tabId): Promise<void> => {
      tabState.requestScan(tabId).catch(() => {});
    },
    subscribe: (listener) =>
      browser.onNotify((message) => {
        listener(message.tabId, message.snapshot);
      }),
  };
}
