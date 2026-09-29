import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVTOOLS_PANEL_ICON_PATH,
  DEVTOOLS_PANEL_PAGE,
  DEVTOOLS_PANEL_TITLE,
} from '../../../src/shared/constants';

let createPanel: ReturnType<typeof vi.fn>;

async function load(entry: string): Promise<void> {
  vi.resetModules();
  await act(async () => {
    await import(entry);
  });
}

beforeEach(() => {
  document.body.className = '';
  document.body.replaceChildren();
  createPanel = vi.fn((_title: string, _icon: string, _page: string, created: () => void) => {
    created();
  });
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn().mockResolvedValue([{ id: 1 }]) },
    devtools: { inspectedWindow: { tabId: 1 }, panels: { create: createPanel } },
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(null),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});

afterEach(() => {
  const root = document.querySelector('#root');
  if (root !== null) render(null, root);
  vi.unstubAllGlobals();
});

describe('extension page entries', () => {
  it.each([
    ['popup', '../../../src/popup/Popup', 'popup-body', 'Loading…'],
    ['DevTools panel', '../../../src/devtools/panel/panelEntry', 'devtools-panel', 'Run Scan'],
  ])('mounts the %s into its root', async (_label, entry, bodyClass, text) => {
    document.body.innerHTML = '<div id="root"></div>';

    await load(entry);

    expect(document.body.classList.contains(bodyClass)).toBe(true);
    expect(document.querySelector('#root')?.textContent).toContain(text);
  });

  it.each([
    ['popup', '../../../src/popup/Popup'],
    ['DevTools panel', '../../../src/devtools/panel/panelEntry'],
  ])('leaves a %s page without a root empty', async (_label, entry) => {
    await load(entry);

    expect(document.body.childElementCount).toBe(0);
  });

  it('registers the Inspector panel in DevTools', async () => {
    await load('../../../src/devtools/devtools');

    expect(createPanel).toHaveBeenCalledWith(
      DEVTOOLS_PANEL_TITLE,
      DEVTOOLS_PANEL_ICON_PATH,
      DEVTOOLS_PANEL_PAGE,
      expect.any(Function)
    );
  });
});
