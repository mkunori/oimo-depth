import { testAmount as gn } from '../test/amounts';

import { describe, expect, it } from 'vitest';
import { createInitialState } from './state';
import { getProductionPerSecond } from './game';
import { createDefaultAutomation } from '../data/automation';

describe('createInitialState', () => {
  it('starts with no harvest or equipment and produces one imo per second', () => {
    const state = createInitialState();

    expect(state).toEqual({
      postDeepResearchSkillLock: false,
      automation: createDefaultAutomation(),
      productionRemainder: { score: gn(0), imo: gn(0) },
      imo: gn(0),
      runEarnedScore: gn(0),
      runStartingImo: gn(0),
      scoreCapStage: 0,
      researchRanks: { geology: 0, resonance: 0 },
      equipmentCounts: { worker: 0, cart: 0, harvester: 0, deepDrill: 0, refinery: 0, veinExtractor: 0, concentrator: 0, rootRelay: 0, coreChamber: 0 },
      permanent: { rootConnectionUnlocked: false, maxDiscoveredStage: 0, deepResearchCount: 0, deepResearchUnlocked: false, prestigeCount: 0, unspentPoints: 0, skillRanks: { automation: 0, breakthrough: 0, harvest: 0, discount: 0, startingImo: 0 } },
    });
    expect(getProductionPerSecond(state)).toBeAmount(1);
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
