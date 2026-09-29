import type { TabStateBrowser } from '../../src/background/tab-state';
import type { BswToUiMessage } from '../../src/shared/messages';

type TabBadge = NonNullable<Parameters<TabStateBrowser['setBadge']>[1]>;

export interface FakeTabStateBrowser extends TabStateBrowser {
  /** Session storage contents. */
  readonly storage: Map<string, unknown>;
  /** Current badge per tab; absent when cleared. */
  readonly badges: Map<number, TabBadge>;
  /** UI notifications in order. */
  readonly messages: BswToUiMessage[];
  /** Makes the next writes reject, to exercise storage failures. */
  failWrites: boolean;
}

/** In-memory adapter for the tab state port. */
export function createFakeTabStateBrowser(): FakeTabStateBrowser {
  const browser: FakeTabStateBrowser = {
    storage: new Map(),
    badges: new Map(),
    messages: [],
    failWrites: false,
    read: async (keys) =>
      Object.fromEntries(
        keys.filter((key) => browser.storage.has(key)).map((key) => [key, browser.storage.get(key)])
      ),
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
    },
  };
  return browser;
}
