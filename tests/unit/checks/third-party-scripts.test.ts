import { describe, it, expect } from 'vitest';
import { THIRD_PARTY_CHECKS } from '../../../src/background/checks/third-party-scripts';
import { makeScanPayload, makePageExtract } from '../../fixtures/makeScanPayload';
import { requireCheck } from './requireCheck';

const tagManager = requireCheck(THIRD_PARTY_CHECKS, '3p-tag-manager');
const sessionReplay = requireCheck(THIRD_PARTY_CHECKS, '3p-session-replay');
const adPixels = requireCheck(THIRD_PARTY_CHECKS, '3p-ad-pixels');
const noSri = requireCheck(THIRD_PARTY_CHECKS, '3p-no-sri');

function makeScriptPage(srcs: string[]): ReturnType<typeof makePageExtract> {
  return makePageExtract({
    scripts: srcs.map((src) => ({ src })),
  });
}

describe('3p-tag-manager', () => {
  it('passes when no tag manager scripts are present', () => {
    const payload = makeScanPayload({ page: makeScriptPage([]) });
    expect(tagManager.run(payload).severity).toBe('pass');
  });

  it('returns notice when Google Tag Manager is detected', () => {
    const payload = makeScanPayload({
      page: makeScriptPage(['https://www.googletagmanager.com/gtm.js?id=GTM-XXXX']),
    });
    const result = tagManager.run(payload);
    expect(result.severity).toBe('notice');
    expect(result.title).toContain('Google Tag Manager');
  });

  it('returns notice when Tealium is detected', () => {
    const payload = makeScanPayload({
      page: makeScriptPage(['https://tags.tealiumiq.com/utag.js']),
    });
    expect(tagManager.run(payload).severity).toBe('notice');
  });
});

describe('3p-session-replay', () => {
  it('passes when no session replay tools are present', () => {
    const payload = makeScanPayload({ page: makeScriptPage([]) });
    expect(sessionReplay.run(payload).severity).toBe('pass');
  });

  it('fails when FullStory is detected', () => {
    const payload = makeScanPayload({
      page: makeScriptPage(['https://edge.fullstory.com/s/fs.js']),
    });
    const result = sessionReplay.run(payload);
    expect(result.severity).toBe('fail');
    expect(result.title).toContain('FullStory');
  });

  it('fails when Hotjar is detected', () => {
    const payload = makeScanPayload({
      page: makeScriptPage(['https://static.hotjar.com/c/hotjar.js']),
    });
    expect(sessionReplay.run(payload).severity).toBe('fail');
  });
});

describe('3p-ad-pixels', () => {
  it('passes when no ad pixels are present', () => {
    const payload = makeScanPayload({ page: makeScriptPage([]) });
    expect(adPixels.run(payload).severity).toBe('pass');
  });

  it('warns when Meta Pixel is detected', () => {
    const payload = makeScanPayload({
      page: makeScriptPage(['https://connect.facebook.net/en_US/fbevents.js']),
    });
    const result = adPixels.run(payload);
    expect(result.severity).toBe('warn');
    expect(result.title).toContain('Meta Pixel');
  });

  it('warns when TikTok Pixel is detected', () => {
    const payload = makeScanPayload({
      page: makeScriptPage(['https://analytics.tiktok.com/i18n/pixel/events.js']),
    });
    expect(adPixels.run(payload).severity).toBe('warn');
  });
});

describe('3p-no-sri', () => {
  it('passes when detected third-party scripts have SRI', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [
          {
            src: 'https://www.googletagmanager.com/gtm.js?id=GTM-XXXX',
            integrity: 'sha384-abc',
            crossorigin: 'anonymous',
          },
        ],
      }),
    });
    expect(noSri.run(payload).severity).toBe('pass');
  });

  it('returns notice when detected third-party scripts lack SRI', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [
          { src: 'https://www.googletagmanager.com/gtm.js?id=GTM-XXXX' },
          { src: 'https://connect.facebook.net/en_US/fbevents.js' },
        ],
      }),
    });
    const result = noSri.run(payload);
    expect(result.severity).toBe('notice');
    expect(result.title).toContain('2');
  });

  it('passes when scripts do not match known third-party patterns', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [{ src: 'https://cdn.example.com/lib.js' }],
      }),
    });
    expect(noSri.run(payload).severity).toBe('pass');
  });

  it('passes when no external scripts are present', () => {
    const payload = makeScanPayload({
      page: makePageExtract({
        scripts: [{ src: '/local/script.js' }],
      }),
    });
    expect(noSri.run(payload).severity).toBe('pass');
  });
});
