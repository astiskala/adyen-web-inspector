import { describe, expect, it } from 'vitest';
import { cssModule } from '../../../src/popup/components/css-module';

describe('cssModule', () => {
  it('reads defined class names and gives an empty class for undefined ones', () => {
    const s = cssModule({ card: 'card_abc' });

    expect(s('card')).toBe('card_abc');
    expect(s('missing')).toBe('');
  });
});
