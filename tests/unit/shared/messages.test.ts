import { describe, expect, it } from 'vitest';
import {
  MSG_CHECKOUT_ACTIVITY_CLEARED,
  MSG_CHECKOUT_ACTIVITY_DETECTED,
  MSG_GET_TAB_STATE,
  MSG_SCAN_COMPLETE,
  MSG_SCAN_ERROR,
  MSG_SCAN_REQUEST,
  MSG_SCAN_RESET,
  MSG_SCAN_STARTED,
} from '../../../src/shared/messages';

describe('shared message constants', () => {
  it('remain stable and unique across extension layers', () => {
    const messageTypes = [
      MSG_CHECKOUT_ACTIVITY_DETECTED,
      MSG_CHECKOUT_ACTIVITY_CLEARED,
      MSG_SCAN_REQUEST,
      MSG_SCAN_STARTED,
      MSG_SCAN_COMPLETE,
      MSG_SCAN_ERROR,
      MSG_SCAN_RESET,
      MSG_GET_TAB_STATE,
    ];

    expect(messageTypes).toEqual([
      'CHECKOUT_ACTIVITY_DETECTED',
      'CHECKOUT_ACTIVITY_CLEARED',
      'SCAN_REQUEST',
      'SCAN_STARTED',
      'SCAN_COMPLETE',
      'SCAN_ERROR',
      'SCAN_RESET',
      'GET_TAB_STATE',
    ]);
    expect(new Set(messageTypes)).toHaveProperty('size', messageTypes.length);
  });
});
