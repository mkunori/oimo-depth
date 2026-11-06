import { describe, expect, it } from 'vitest';
import { createInitialState } from './state';
import { getProductionPerSecond } from './game';

describe('createInitialState', () => {
  it('starts with no harvest or equipment and produces one imo per second', () => {
    const state = createInitialState();

    expect(state).toEqual({
      imo: 0,
      runEarnedScore: 0,
      runStartingImo: 0,
      scoreCapStage: 0,
      equipmentCounts: { worker: 0, cart: 0, harvester: 0, deepDrill: 0, refinery: 0 },
      permanent: { prestigeCount: 0, unspentPoints: 0, skillRanks: { breakthrough: 0, harvest: 0, discount: 0, startingImo: 0 } },
    });
    expect(getProductionPerSecond(state)).toBe(1);
  });

  it('does not share equipment counts between new games', () => {
    const first = createInitialState();
    const second = createInitialState();

    expect(first).not.toBe(second);
    expect(first.equipmentCounts).not.toBe(second.equipmentCounts);
    expect(first.permanent).not.toBe(second.permanent);
    expect(first.permanent.skillRanks).not.toBe(second.permanent.skillRanks);
  });
});
