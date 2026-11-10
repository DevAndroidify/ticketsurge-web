import { describe, expect, it } from 'vitest';
import { feedSentence, feedTime } from './feed';

describe('feedSentence', () => {
  it('reads a lost race as a 409, in the error tone', () => {
    expect(
      feedSentence({ bot: 'bot-12', text: '409 · lost the race for 2 seat(s), retrying' }),
    ).toEqual({
      text: 'bot-12 lost a race for 2 seats and got a 409. Trying others.',
      tone: 'error',
    });
  });

  it('names a 429 plainly', () => {
    expect(feedSentence({ bot: 'bot-9', text: 'hold failed: RATE_LIMITED' })).toEqual({
      text: 'bot-9 was clicking too fast and got a 429.',
      tone: 'error',
    });
  });

  it('keeps other failures out of the error colour', () => {
    expect(feedSentence({ bot: 'bot-3', text: 'hold failed: SERVICE_UNAVAILABLE' }).tone).toBe(
      'muted',
    );
  });

  it('counts tickets with the right plural', () => {
    expect(feedSentence({ bot: 'bot-1', text: 'confirmed · 1 ticket(s)' }).text).toBe(
      'bot-1 got 1 ticket.',
    );
    expect(feedSentence({ bot: 'bot-1', text: 'confirmed · 3 ticket(s)' }).text).toBe(
      'bot-1 got 3 tickets.',
    );
  });

  it('describes the crowd arriving', () => {
    expect(
      feedSentence({ bot: 'swarm', text: '300 buyers arrive for Flash sale 12:02' }).text,
    ).toBe('300 buyers arrive for Flash sale 12:02.');
  });

  it('falls back to the raw text for anything new', () => {
    expect(feedSentence({ bot: 'bot-2', text: 'did something new' }).text).toBe(
      'bot-2: did something new.',
    );
  });
});

describe('feedTime', () => {
  it('formats time since the start of the sale', () => {
    expect(feedTime(1_000 + 42_100, 1_000)).toBe('00:42.1');
    expect(feedTime(1_000 + 125_000, 1_000)).toBe('02:05.0');
  });
});
