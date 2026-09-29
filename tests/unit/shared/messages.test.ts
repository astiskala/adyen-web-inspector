import { describe, expect, it } from 'vitest';
import {
  EMPTY_TAB_SNAPSHOT,
  MSG_CHECKOUT_ACTIVITY_CLEARED,
  MSG_CHECKOUT_ACTIVITY_DETECTED,
  MSG_GET_TAB_STATE,
  MSG_SCAN_REQUEST,
  MSG_TAB_STATE_CHANGED,
} from '../../../src/shared/messages';

describe('shared message constants', () => {
  it('remain stable and unique across extension layers', () => {
    const messageTypes = [
      MSG_CHECKOUT_ACTIVITY_DETECTED,
      MSG_CHECKOUT_ACTIVITY_CLEARED,
      MSG_SCAN_REQUEST,
      MSG_GET_TAB_STATE,
      MSG_TAB_STATE_CHANGED,
    ];

    expect(messageTypes).toEqual([
      'CHECKOUT_ACTIVITY_DETECTED',
      'CHECKOUT_ACTIVITY_CLEARED',
      'SCAN_REQUEST',
      'GET_TAB_STATE',
      'TAB_STATE_CHANGED',
    ]);
    expect(new Set(messageTypes)).toHaveProperty('size', messageTypes.length);
  });

  it('describes an empty tab as idle with nothing detected or stored', () => {
    expect(EMPTY_TAB_SNAPSHOT).toEqual({
      result: null,
      checkoutActivity: { detected: false },
      scan: { state: 'idle' },
    });
  });
});
