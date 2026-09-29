import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromeTabStateBrowser } from '../../../src/background/chrome-tab-state-browser';
import { EMPTY_TAB_SNAPSHOT } from '../../../src/shared/messages';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubChrome(): {
  session: Record<string, ReturnType<typeof vi.fn>>;
  action: Record<string, ReturnType<typeof vi.fn>>;
  sendMessage: ReturnType<typeof vi.fn>;
} {
  const session = {
    get: vi.fn().mockResolvedValue({ scan_result_1: 'stored' }),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const action = {
    setBadgeText: vi.fn().mockRejectedValue(new Error('No tab with id: 1')),
    setBadgeBackgroundColor: vi.fn().mockRejectedValue(new Error('No tab with id: 1')),
  };
  const sendMessage = vi.fn().mockRejectedValue(new Error('Receiving end does not exist.'));
  vi.stubGlobal('chrome', { storage: { session }, action, runtime: { sendMessage } });
  return { session, action, sendMessage };
}

describe('chromeTabStateBrowser', () => {
  it('reads, writes and removes session storage', async () => {
    const { session } = stubChrome();

    await expect(chromeTabStateBrowser.read(['scan_result_1'])).resolves.toEqual({
      scan_result_1: 'stored',
    });
    await chromeTabStateBrowser.write({ checkout_activity_1: true });
    await chromeTabStateBrowser.remove(['checkout_activity_1']);

    expect(session['get']).toHaveBeenCalledWith(['scan_result_1']);
    expect(session['set']).toHaveBeenCalledWith({ checkout_activity_1: true });
    expect(session['remove']).toHaveBeenCalledWith(['checkout_activity_1']);
  });

  it('sets and clears the badge, ignoring closed tabs', () => {
    const { action } = stubChrome();

    chromeTabStateBrowser.setBadge(1, { text: '90', color: '#188038' });
    chromeTabStateBrowser.setBadge(1, null);

    expect(action['setBadgeText']).toHaveBeenNthCalledWith(1, { tabId: 1, text: '90' });
    expect(action['setBadgeText']).toHaveBeenNthCalledWith(2, { tabId: 1, text: '' });
    expect(action['setBadgeBackgroundColor']).toHaveBeenCalledTimes(1);
  });

  it('notifies open views and tolerates having none', () => {
    const { sendMessage } = stubChrome();

    const message = {
      type: 'TAB_STATE_CHANGED',
      tabId: 1,
      snapshot: EMPTY_TAB_SNAPSHOT,
    } as const;
    chromeTabStateBrowser.notify(message);

    expect(sendMessage).toHaveBeenCalledWith(message);
  });
});
