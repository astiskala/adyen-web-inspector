import { describe, expect, it } from 'vitest';
import {
  MSG_ADYEN_DETECTED,
  MSG_ADYEN_NOT_DETECTED,
  MSG_GET_RESULT,
  MSG_SCAN_COMPLETE,
  MSG_SCAN_ERROR,
  MSG_SCAN_REQUEST,
  MSG_SCAN_RESET,
  MSG_SCAN_STARTED,
} from '../../../src/shared/messages';

describe('shared message constants', () => {
  it('remain stable and unique across extension layers', () => {
    const messageTypes = [
      MSG_ADYEN_DETECTED,
      MSG_ADYEN_NOT_DETECTED,
      MSG_SCAN_REQUEST,
      MSG_SCAN_STARTED,
      MSG_SCAN_COMPLETE,
      MSG_SCAN_ERROR,
      MSG_SCAN_RESET,
      MSG_GET_RESULT,
    ];

    expect(messageTypes).toEqual([
      'ADYEN_DETECTED',
      'ADYEN_NOT_DETECTED',
      'SCAN_REQUEST',
      'SCAN_STARTED',
      'SCAN_COMPLETE',
      'SCAN_ERROR',
      'SCAN_RESET',
      'GET_RESULT',
    ]);
    expect(new Set(messageTypes)).toHaveProperty('size', messageTypes.length);
  });
});
