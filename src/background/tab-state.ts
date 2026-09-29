/**
 * Tab state — everything the extension remembers about one tab: the passive
 * detector's checkout activity, the stored scan result, and the Scan in
 * flight. It owns the storage key scheme, the badge, and the lifecycle rules:
 * one Scan per page at a time, and navigation discards the tab's state and any
 * pending Scan, whose result would describe a page that is gone.
 *
 * Each tab's transitions run in order, so a navigation reset and a finishing
 * Scan cannot interleave. The module reaches Chrome only through its port.
 */

import {
  STATUS_COLORS,
  STORAGE_CHECKOUT_ACTIVITY_PREFIX,
  STORAGE_SCAN_RESULT_PREFIX,
  STORAGE_VERSION_PREFIX,
} from '../shared/constants.js';
import {
  MSG_SCAN_COMPLETE,
  MSG_SCAN_ERROR,
  MSG_SCAN_RESET,
  MSG_SCAN_STARTED,
  type BswToUiMessage,
  type CheckoutActivity,
  type TabSnapshot,
} from '../shared/messages.js';
import type { HealthScore, ScanResult } from '../shared/types.js';
import { describeError, isScanResult } from '../shared/utils.js';

/** A badge on the extension's action icon for one tab. */
interface TabBadge {
  readonly text: string;
  readonly color: string;
}

/** Everything the tab state needs from the browser. */
export interface TabStateBrowser {
  /** Reads session-scoped values; missing keys are omitted. */
  read(keys: readonly string[]): Promise<Readonly<Record<string, unknown>>>;
  write(items: Readonly<Record<string, unknown>>): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
  /** Shows a badge on the tab's action icon, or clears it when null. */
  setBadge(tabId: number, badge: TabBadge | null): void;
  /** Notifies open popups and DevTools panels. */
  notify(message: BswToUiMessage): void;
}

/** Runs a Scan of the tab's current page. */
type RunScan = (tabId: number) => Promise<ScanResult>;

interface TabState {
  /** The passive detector saw a mounted Drop-in, Component, or Adyen iframe. */
  checkoutActivityDetected(tabId: number, version?: string): Promise<void>;
  checkoutActivityCleared(tabId: number): Promise<void>;
  /** Scans the tab unless a Scan of its current page is already running. */
  requestScan(tabId: number): Promise<void>;
  /** The tab started loading a document: its state and any pending Scan are discarded. */
  navigated(tabId: number): Promise<void>;
  removed(tabId: number): Promise<void>;
  read(tabId: number): Promise<TabSnapshot>;
}

interface TabRuntime {
  readonly tabId: number;
  /** Incremented when the tab's page goes away, so a pending Scan can tell it is stale. */
  generation: number;
  scanning: boolean;
  queue: Promise<unknown>;
}

type ScanOutcome = { readonly result: ScanResult } | { readonly error: unknown };

const SCANNING_BADGE: TabBadge = { text: '…', color: STATUS_COLORS.warn };
const ACTIVITY_BADGE: TabBadge = { text: '✓', color: STATUS_COLORS.pass };

function resultKey(tabId: number): string {
  return `${STORAGE_SCAN_RESULT_PREFIX}${tabId}`;
}

function activityKey(tabId: number): string {
  return `${STORAGE_CHECKOUT_ACTIVITY_PREFIX}${tabId}`;
}

function versionKey(tabId: number): string {
  return `${STORAGE_VERSION_PREFIX}${tabId}`;
}

function tabKeys(tabId: number): string[] {
  return [resultKey(tabId), activityKey(tabId), versionKey(tabId)];
}

function healthColor(tier: HealthScore['tier']): string {
  if (tier === 'excellent') return STATUS_COLORS.pass;
  if (tier === 'issues') return STATUS_COLORS.warn;
  return STATUS_COLORS.fail;
}

/** A stored result decides the badge; without one, checkout activity does. */
function badgeFor({ result, checkoutActivity }: TabSnapshot): TabBadge | null {
  if (result !== null) {
    if (!result.sdkPresence.detected) return null;
    return { text: `${result.health.score}`, color: healthColor(result.health.tier) };
  }
  return checkoutActivity.detected ? ACTIVITY_BADGE : null;
}

function readActivity(stored: Readonly<Record<string, unknown>>, tabId: number): CheckoutActivity {
  if (stored[activityKey(tabId)] !== true) return { detected: false };
  const version = stored[versionKey(tabId)];
  return typeof version === 'string' ? { detected: true, version } : { detected: true };
}

/** Runs a transition after the tab's earlier ones; a failed transition does not block later ones. */
function enqueue<T>(tab: TabRuntime, transition: () => T | Promise<T>): Promise<T> {
  const next = tab.queue.then(transition);
  tab.queue = next.catch(() => {});
  return next;
}

/** Creates the tab state over a browser port; `scan` performs the Scan itself. */
export function createTabState(browser: TabStateBrowser, scan: RunScan): TabState {
  const tabs = new Map<number, TabRuntime>();

  function runtime(tabId: number): TabRuntime {
    let tab = tabs.get(tabId);
    if (tab === undefined) {
      tab = { tabId, generation: 0, scanning: false, queue: Promise.resolve() };
      tabs.set(tabId, tab);
    }
    return tab;
  }

  async function read(tabId: number): Promise<TabSnapshot> {
    const stored = await browser.read(tabKeys(tabId));
    const result = stored[resultKey(tabId)];
    return {
      result: isScanResult(result) ? result : null,
      checkoutActivity: readActivity(stored, tabId),
    };
  }

  async function refreshBadge(tab: TabRuntime): Promise<void> {
    browser.setBadge(tab.tabId, tab.scanning ? SCANNING_BADGE : badgeFor(await read(tab.tabId)));
  }

  /** Forgets the tab's page: stored state goes, and any pending Scan becomes stale. */
  async function discardPage(tab: TabRuntime): Promise<void> {
    tab.generation += 1;
    tab.scanning = false;
    await browser.remove(tabKeys(tab.tabId));
  }

  function startScan(tab: TabRuntime): Promise<number | null> {
    return enqueue(tab, () => {
      if (tab.scanning) return null;
      tab.scanning = true;
      browser.setBadge(tab.tabId, SCANNING_BADGE);
      browser.notify({ type: MSG_SCAN_STARTED, tabId: tab.tabId });
      return tab.generation;
    });
  }

  function finishScan(tab: TabRuntime, generation: number, outcome: ScanOutcome): Promise<void> {
    const { tabId } = tab;
    return enqueue(tab, async () => {
      if (tab.generation !== generation) return;
      tab.scanning = false;
      try {
        if ('error' in outcome) throw outcome.error;
        await browser.write({ [resultKey(tabId)]: outcome.result });
        browser.notify({ type: MSG_SCAN_COMPLETE, tabId, result: outcome.result });
      } catch (error: unknown) {
        browser.notify({ type: MSG_SCAN_ERROR, tabId, error: describeError(error) });
      }
      await refreshBadge(tab);
    });
  }

  return {
    checkoutActivityDetected(tabId, version): Promise<void> {
      const tab = runtime(tabId);
      return enqueue(tab, async () => {
        await browser.write({
          [activityKey(tabId)]: true,
          ...(version === undefined ? {} : { [versionKey(tabId)]: version }),
        });
        await refreshBadge(tab);
      });
    },

    checkoutActivityCleared(tabId): Promise<void> {
      const tab = runtime(tabId);
      return enqueue(tab, async () => {
        await browser.remove([activityKey(tabId), versionKey(tabId)]);
        await refreshBadge(tab);
      });
    },

    async requestScan(tabId): Promise<void> {
      const tab = runtime(tabId);
      const generation = await startScan(tab);
      if (generation === null) return;
      const outcome = await scan(tabId).then(
        (result): ScanOutcome => ({ result }),
        (error: unknown): ScanOutcome => ({ error })
      );
      await finishScan(tab, generation, outcome);
    },

    navigated(tabId): Promise<void> {
      const tab = runtime(tabId);
      return enqueue(tab, async () => {
        try {
          await discardPage(tab);
        } finally {
          browser.setBadge(tabId, null);
          browser.notify({ type: MSG_SCAN_RESET, tabId });
        }
      });
    },

    async removed(tabId): Promise<void> {
      const tab = runtime(tabId);
      tabs.delete(tabId);
      await enqueue(tab, () => discardPage(tab));
    },

    read,
  };
}
