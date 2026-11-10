import type { Activity } from '../lib/bots/swarm';

/** `error` is only for 409s and 429s; `ink` for outcomes worth reading; `muted` for the rest. */
export type FeedTone = 'ink' | 'muted' | 'error';

export interface FeedLine {
  id: number;
  /** Time since the sale started, like 00:42.1. */
  time: string;
  text: string;
  tone: FeedTone;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Turns the swarm's terse activity log into plain sentences, e.g.
 * "409 · lost the race for 2 seat(s), retrying" → "bot-12 lost a race for 2 seats and got a 409."
 */
export function feedSentence({ bot, text }: Pick<Activity, 'bot' | 'text'>): {
  text: string;
  tone: FeedTone;
} {
  let m: RegExpMatchArray | null;
  if (bot === 'swarm') {
    if ((m = /^(\d+) buyers arrive for (.+)$/.exec(text))) {
      return { text: `${m[1]} buyers arrive for ${m[2]}.`, tone: 'ink' };
    }
    if (text === 'Every buyer has finished') return { text: 'Every buyer is done.', tone: 'ink' };
    return { text: `${text}.`, tone: 'muted' };
  }
  if (text === 'admitted from the waiting room') {
    return { text: `${bot} was let in.`, tone: 'muted' };
  }
  if ((m = /^held (\d+) seat/.exec(text))) {
    return { text: `${bot} is holding ${plural(Number(m[1]), 'seat')}.`, tone: 'muted' };
  }
  if ((m = /^409 · lost the race for (\d+) seat/.exec(text))) {
    const seats = Number(m[1]) === 1 ? 'a seat' : `${m[1]} seats`;
    return { text: `${bot} lost a race for ${seats} and got a 409. Trying others.`, tone: 'error' };
  }
  if (text.startsWith('sent the booking twice')) {
    return {
      text: `${bot} sent its booking twice. Same key, so still one booking.`,
      tone: 'muted',
    };
  }
  if (text === 'duplicate request created a second booking') {
    return {
      text: `${bot}'s duplicate request made a second booking. That should never happen.`,
      tone: 'ink',
    };
  }
  if (text.startsWith('202 · booking accepted')) {
    return { text: `${bot} booked and is paying.`, tone: 'muted' };
  }
  if ((m = /^confirmed · (\d+) ticket/.exec(text))) {
    return { text: `${bot} got ${plural(Number(m[1]), 'ticket')}.`, tone: 'ink' };
  }
  if (text.startsWith('payment failed')) {
    return { text: `${bot}'s payment was declined. The seats are back.`, tone: 'muted' };
  }
  if (text.startsWith('payment too slow')) {
    return {
      text: `${bot} paid too slowly. The booking expired and the seats are back.`,
      tone: 'muted',
    };
  }
  if ((m = /^walked away from (\d+) seat/.exec(text))) {
    return {
      text: `${bot} walked away from ${plural(Number(m[1]), 'seat')}. They come back when the hold runs out.`,
      tone: 'muted',
    };
  }
  if (text === 'sold out before getting a seat') {
    return { text: `${bot} missed out. Sold out.`, tone: 'muted' };
  }
  if ((m = /^gave up after (\d+) lost races/.exec(text))) {
    return { text: `${bot} lost ${m[1]} races and gave up.`, tone: 'muted' };
  }
  if (
    (m = /^(?:hold failed|booking rejected|queue error|sign-up failed): (?:(\d{3}) )?(\S+)/.exec(
      text,
    ))
  ) {
    const status = m[1] ?? (/RATE_LIMIT/.test(m[2] ?? '') ? '429' : undefined);
    if (status === '429')
      return { text: `${bot} was clicking too fast and got a 429.`, tone: 'error' };
    if (status === '409') return { text: `${bot} was turned away with a 409.`, tone: 'error' };
    return { text: `${bot} hit an error (${m[2]}).`, tone: 'muted' };
  }
  return { text: `${bot}: ${text}.`, tone: 'muted' };
}

/** Minutes, seconds and tenths since the sale started. */
export function feedTime(at: number, startedAt: number | undefined): string {
  const ms = Math.max(0, at - (startedAt ?? at));
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1000;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

export function feedLines(
  activity: readonly Activity[],
  startedAt: number | undefined,
): FeedLine[] {
  return activity.map((item) => ({
    id: item.id,
    time: feedTime(item.at, startedAt),
    ...feedSentence(item),
  }));
}
