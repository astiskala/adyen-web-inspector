import type { TabStateBrowser } from '../../src/background/tab-state';
import type { BswToUiMessage } from '../../src/shared/messages';

type TabBadge = NonNullable<Parameters<TabStateBrowser['setBadge']>[1]>;
type NotifyListener = (message: BswToUiMessage) => void;

export interface FakeTabStateBrowser extends TabStateBrowser {
  /** Session storage contents. */
  readonly storage: Map<string, unknown>;
  /** Current badge per tab; absent when cleared. */
  readonly badges: Map<number, TabBadge>;
  /** UI notifications in order. */
  readonly messages: BswToUiMessage[];
  /** Makes the next writes reject, to exercise storage failures. */
  failWrites: boolean;
  /** Makes the next reads reject, to exercise storage failures. */
  failReads: boolean;
  /** Delivers later notifications to a listener, as open views receive them; returns an unsubscribe function. */
  onNotify(listener: NotifyListener): () => void;
}

/** In-memory adapter for the tab state port. */
export function createFakeTabStateBrowser(): FakeTabStateBrowser {
  const listeners = new Set<NotifyListener>();
  const browser: FakeTabStateBrowser = {
    storage: new Map(),
    badges: new Map(),
    messages: [],
    failWrites: false,
    failReads: false,
    onNotify: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: async (keys) => {
      if (browser.failReads) throw new Error('Storage unavailable');
      return Object.fromEntries(
        keys.filter((key) => browser.storage.has(key)).map((key) => [key, browser.storage.get(key)])
      );
    },
    write: async (items) => {
      if (browser.failWrites) throw new Error('Storage quota exceeded');
      for (const [key, value] of Object.entries(items)) browser.storage.set(key, value);
    },
    remove: async (keys) => {
      for (const key of keys) browser.storage.delete(key);
    },
    setBadge: (tabId, badge) => {
      if (badge === null) browser.badges.delete(tabId);
      else browser.badges.set(tabId, badge);
    },
    notify: (message) => {
      browser.messages.push(message);
      for (const listener of listeners) listener(message);
    },
  };
  return browser;
}
