import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MSG_CHECKOUT_ACTIVITY_CLEARED,
  MSG_CHECKOUT_ACTIVITY_DETECTED,
} from '../../../src/shared/messages';

const SDK_URL = 'https://checkoutshopper-live.cdn.adyen.com/checkoutshopper/sdk/6.31.0/adyen.js';

let sendMessage: ReturnType<typeof vi.fn>;

/** Lets mutation callbacks run, then advances the virtual clock. */
async function advance(ms: number): Promise<void> {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(ms);
}

function sentTypes(): string[] {
  return sendMessage.mock.calls.map(([message]) => (message as { type: string }).type);
}

function append(markup: string): void {
  const template = document.createElement('template');
  template.innerHTML = markup;
  document.body.append(template.content);
}

/** Mounts and then removes a checkout, navigating after each change instead of waiting out the debounce. */
async function detect(navigate: () => void): Promise<void> {
  append('<div class="adyen-checkout__dropin"></div>');
  await Promise.resolve();
  navigate();
  await vi.advanceTimersByTimeAsync(0);
  document.body.replaceChildren();
  await Promise.resolve();
  navigate();
  await vi.advanceTimersByTimeAsync(0);
}

beforeAll(async () => {
  vi.useFakeTimers();
  sendMessage = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  document.body.replaceChildren();
  await import('../../../src/content/detector');
});

beforeEach(async () => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  await advance(7000);
  sendMessage.mockClear();
  sendMessage.mockResolvedValue(undefined);
});

afterAll(async () => {
  document.body.replaceChildren();
  await advance(7000);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('passive detector', () => {
  it('reports a mounted checkout with the SDK version from an Adyen-hosted script', async () => {
    append(`<script src="${SDK_URL}"></script><div class="adyen-checkout__dropin"></div>`);
    await advance(200);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      type: MSG_CHECKOUT_ACTIVITY_DETECTED,
      tabId: 0,
      version: '6.31.0',
    });
  });

  it('reports an Adyen iframe without a version, and does not repeat an unchanged state', async () => {
    append('<iframe name="adyen-card"></iframe>');
    await advance(200);
    append('<link rel="preload" href="https://merchant.example/a.css">');
    await advance(200);

    expect(sendMessage.mock.calls).toEqual([[{ type: MSG_CHECKOUT_ACTIVITY_DETECTED, tabId: 0 }]]);
  });

  it('reports the checkout gone once its elements are removed', async () => {
    append('<div id="mount" class="adyen-checkout__card-input"></div>');
    await advance(200);

    document.querySelector('#mount')?.remove();
    await advance(200);

    expect(sentTypes()).toEqual([MSG_CHECKOUT_ACTIVITY_DETECTED, MSG_CHECKOUT_ACTIVITY_CLEARED]);
  });

  it('debounces bursts of interesting mutations into one report', async () => {
    append('<div class="adyen-checkout__button"></div>');
    await advance(100);
    append('<img src="https://checkoutshopper-test.adyen.com/logo.svg">');
    await advance(100);
    expect(sendMessage).not.toHaveBeenCalled();

    await advance(100);
    expect(sentTypes()).toEqual([MSG_CHECKOUT_ACTIVITY_DETECTED]);
  });

  it('ignores mutations that cannot change checkout activity', async () => {
    append('plain text<div class="hero"></div><a href="/help">Help</a>');
    await advance(500);
    document.querySelector('.hero')?.remove();
    await advance(500);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('checks again right away after single-page navigation', async () => {
    await detect(() => {
      history.pushState({}, '', '#one');
    });
    await detect(() => {
      history.replaceState({}, '', '#two');
    });
    await detect(() => {
      globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await detect(() => {
      globalThis.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(sentTypes()).toEqual(
      Array.from({ length: 4 }, () => [
        MSG_CHECKOUT_ACTIVITY_DETECTED,
        MSG_CHECKOUT_ACTIVITY_CLEARED,
      ]).flat()
    );
  });

  it('keeps detecting when the service worker is not listening', async () => {
    sendMessage.mockRejectedValue(new Error('Receiving end does not exist.'));

    append('<div class="adyen-checkout__dropin"></div>');
    await advance(200);

    expect(sentTypes()).toEqual([MSG_CHECKOUT_ACTIVITY_DETECTED]);
  });
});
