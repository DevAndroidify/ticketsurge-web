import { describe, expect, it } from 'vitest';
import { PHASES, type BotPhase } from '../lib/bots/swarm';
import { crowdGroups, finishedSentence, formatDuration, percent } from './summary';

const phases = (counts: Partial<Record<BotPhase, number>>) =>
  Object.fromEntries(PHASES.map((p) => [p, counts[p] ?? 0])) as Record<BotPhase, number>;

describe('crowdGroups', () => {
  it('puts every phase in exactly one group', () => {
    const all = phases(Object.fromEntries(PHASES.map((p) => [p, 1])));
    const groups = crowdGroups(all);
    expect(groups.line + groups.trying + groups.got + groups.missed).toBe(PHASES.length);
  });

  it('counts buyers by where they are', () => {
    expect(
      crowdGroups(phases({ queued: 5, paying: 2, confirmed: 7, lost: 3, expired: 1 })),
    ).toEqual({
      line: 5,
      trying: 2,
      got: 7,
      missed: 4,
    });
  });
});

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(41_400)).toBe('41 s');
    expect(formatDuration(125_000)).toBe('2 min 05 s');
  });

  it('rounds percentages and survives an empty whole', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(5, 0)).toBe(0);
  });

  it('summarises a finished sale in one line', () => {
    expect(
      finishedSentence({
        ms: 41_000,
        sold: 384,
        seats: 384,
        buyers: 300,
        got: 112,
        refused: 1204,
        twice: 0,
      }),
    ).toBe(
      'Sale over in 41 s. 384 of 384 seats sold; 112 of 300 buyers got tickets. 1,204 double sales refused with a 409, 0 got through.',
    );
  });
});
