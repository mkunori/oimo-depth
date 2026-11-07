import { testAmount as gn, stringifyTestSave } from '../test/amounts';

import { describe, expect, it } from 'vitest';
import { createResearchReadyState, createBreakthroughReadyState } from '../test/progress';
import { getDeepResearch, getDeepResearchReset, performDeepResearch, getResearchPurchase, purchaseResearch, resetResearch } from './research';
import { advanceGame, advanceWithAutomation, configureAutomation, getEquipmentPrice, getProductionPerSecond, getPurchaseQuote, purchaseEquipment, MAX_AUTOMATIC_PURCHASES } from './game';
import { createInitialState } from './state';
import type { GameState } from './state';
import { prestigeGame, purchaseSkill } from './prestige';
import { performBreakthrough } from './breakthrough';
import { createSave, parseSave, SAVE_VERSION, serializeSave, settleOffline } from './save';
import { EQUIPMENT_IDS } from '../data/equipment';
import { RESEARCH_IDS } from '../data/research';
import type { AutomationPolicy } from '../data/automation';

describe('deep research breakthrough', () => {
  it('progresses through four analyses, refunds only lost ranks, preserves grants/rights and unlocks purchases after prestige', () => {
    let state = purchaseSkill(createResearchReadyState(true), 'startingImo');
    state = purchaseSkill(prestigeGame(state), 'discount');
    state = advanceGame(performBreakthrough(advanceGame(state, 1e6)), 1e9);
    expect(state.runStartingImo).toBeAmount(50);
    const cases = [
      { ranks: [0, 0, 0], refund: 10 }, { ranks: [3, 0, 0], refund: 4 },
      { ranks: [3, 0, 1], refund: 3 }, { ranks: [3, 2, 1], refund: 0 },
    ];
    for (const [index, expected] of cases.entries()) {
      const before = state;
      const quote = getDeepResearchReset(state, 'startingImo');
      expect(quote.refund).toBe(expected.refund);
      if (index === 2) {
        const alternative = performDeepResearch(state, 'discount');
        expect(alternative.permanent.skillRanks).toEqual({ harvest: 3, discount: 2, startingImo: 0, breakthrough: 1, automation: 1 });
      }
      state = performDeepResearch(state, 'startingImo');
      expect(state.permanent.deepResearchCount).toBe(index + 1);
      expect(state.permanent.skillRanks).toEqual({ harvest: expected.ranks[0], discount: expected.ranks[1], startingImo: expected.ranks[2], breakthrough: 1, automation: 1 });
      expect(state.permanent.unspentPoints).toBe(before.permanent.unspentPoints + expected.refund);
      expect(state.postDeepResearchSkillLock).toBe(index < 3);
      expect(state).toEqual({ ...before, scoreCapStage: 2, postDeepResearchSkillLock: index < 3, permanent: state.permanent });
      expect(parseSave(serializeSave(createSave(state, 123))).gameState).toEqual(state);
      expect(performDeepResearch(state, 'discount')).toBe(state);
      if (index < 3) for (const id of ['harvest', 'discount', 'startingImo'] as const) expect(purchaseSkill(state, id)).toBe(state);
      else expect(purchaseSkill(state, 'startingImo').permanent.skillRanks.startingImo).toBe(2);
      const next = prestigeGame(state);
      expect(next.postDeepResearchSkillLock).toBe(false);
      expect(next.permanent.deepResearchCount).toBe(index + 1);
      state = next;
      for (const id of ['harvest', 'harvest', 'harvest', 'discount', 'discount', 'startingImo'] as const) {
        const target = id === 'harvest' ? 3 : id === 'discount' ? 2 : 1;
        if (state.permanent.skillRanks[id] < target) state = purchaseSkill(state, id);
      }
      expect(state.permanent.skillRanks).toEqual(before.permanent.skillRanks);
      state = advanceGame(performBreakthrough(advanceGame(state, 1e6)), 1e9);
    }
  });

  it('migrates v7 research ownership without retroactive reset and rejects forged history or locks', () => {
    const old = { ...createResearchReadyState(true), scoreCapStage: 2,
      permanent: { ...createResearchReadyState(true).permanent, deepResearchUnlocked: true } };
    const migrated = parseSave(stringifyTestSave({ saveVersion: 7, savedAt: 321, gameState: old }));
    expect(migrated.savedAt).toBe(321);
    expect(migrated.gameState).toEqual({ ...old, permanent: { ...old.permanent, deepResearchCount: 1, maxDiscoveredStage: 2, depthMeters: 0, depthRemainder: 0 } });
    expect(migrated.gameState.postDeepResearchSkillLock).toBe(false);
    const reset = performDeepResearch(createResearchReadyState(true));
    for (const change of [
      { permanent: { ...reset.permanent, deepResearchCount: -1 } },
      { permanent: { ...reset.permanent, deepResearchCount: 0.5 } },
      { permanent: { ...reset.permanent, deepResearchCount: 3 } },
      { permanent: { ...reset.permanent, deepResearchCount: 2 }, postDeepResearchSkillLock: false },
      { permanent: { ...reset.permanent, deepResearchUnlocked: false } },
      { scoreCapStage: 1 }, { postDeepResearchSkillLock: undefined }, { runStartingImo: gn(101) },
      { permanent: { ...reset.permanent, unspentPoints: 0 } },
    ]) expect(() => createSave({ ...reset, ...change } as GameState, 0)).toThrow();
    const fakeLegacy = { ...old, permanent: { ...old.permanent, skillRanks: reset.permanent.skillRanks,
      unspentPoints: reset.permanent.unspentPoints } };
    expect(() => parseSave(stringifyTestSave({ saveVersion: 7, savedAt: 0, gameState: fakeLegacy }))).toThrow();
  });

  it('requires stage1 SCORE1e9, preserves progress and unlocks once without any funds', () => {
    for (const state of [createInitialState(), createBreakthroughReadyState(), performBreakthrough(createBreakthroughReadyState())]) {
      expect(getDeepResearch(state).canResearch).toBe(false);
      expect(performDeepResearch(state)).toBe(state);
    }
    const before = { ...createResearchReadyState(), imo: gn(0) };
    Object.freeze(before.permanent); Object.freeze(before.equipmentCounts); Object.freeze(before);
    const after = performDeepResearch(before);
    expect(after).toEqual({ ...before, scoreCapStage: 2, postDeepResearchSkillLock: true,
      permanent: { ...before.permanent, deepResearchUnlocked: true, deepResearchCount: 1, maxDiscoveredStage: 2, unspentPoints: 7,
        skillRanks: { ...before.permanent.skillRanks, harvest: 0, discount: 0 } } });
    expect(after.equipmentCounts).toBe(before.equipmentCounts);
    expect(after.automation).toBe(before.automation);
    expect(performDeepResearch(after)).toBe(after);
    expect(performBreakthrough(after)).toBe(after);
    expect(advanceGame(after, 1).runEarnedScore).toBeGreaterThanAmount(1e9);
  });

  it('keeps permission and configuration through prestige, resets run upgrades and repeats for free', () => {
    const researched = purchaseResearch(performDeepResearch(createResearchReadyState()), 'geology');
    const next = prestigeGame(researched);
    expect(next.permanent.deepResearchUnlocked).toBe(true);
    expect(next.researchRanks).toEqual(createInitialState().researchRanks);
    expect(next.equipmentCounts).toEqual(createInitialState().equipmentCounts);
    expect(next.automation).toBe(researched.automation);
    expect(next.scoreCapStage).toBe(0);
    expect(performDeepResearch(next)).toBe(next);
    const repeat = advanceGame(performBreakthrough(advanceGame(next, 1e6)), 1e9);
    expect(performDeepResearch(repeat)).toEqual({ ...repeat, scoreCapStage: 2, postDeepResearchSkillLock: true,
      permanent: { ...repeat.permanent, deepResearchCount: 2 } });
  });

  it.each(['veinExtractor', 'concentrator'] as const)('locks %s until stage2 and gives its actual marginal growth', (id) => {
    const capped = createResearchReadyState();
    expect(purchaseEquipment(capped, id, 'MAX')).toBe(capped);
    let state = performDeepResearch(capped);
    if (id === 'concentrator') state = advanceGame(state, 1);
    const before = getProductionPerSecond(state);
    const bought = purchaseEquipment(state, id, 1);
    expect(bought.equipmentCounts[id]).toBe(1);
    expect(bought.runEarnedScore).toBeAmount(state.runEarnedScore);
    expect(bought.imo).toBeAmount(state.imo.subtract(getEquipmentPrice(id, 0, state.permanent)));
    expect(getProductionPerSecond(bought)).toBeGreaterThanAmount(before.multiply(4));
  });
});

describe('run research upgrades', () => {
  it('bounds every possible stage2 automatic purchase below the processing limit, even with max discount', () => {
    const permanent = purchaseSkill(prestigeGame(createResearchReadyState(true)), 'discount').permanent;
    expect(permanent.skillRanks.discount).toBe(2);
    let total = 0;
    for (const id of EQUIPMENT_IDS) {
      let count = 0;
      while (getEquipmentPrice(id, count, permanent).lte(1e12 + 100)) count += 1;
      total += count;
    }
    expect(total).toBeLessThan(MAX_AUTOMATIC_PURCHASES);
  });
  it('has strict price/rank boundaries and spends balance without spending SCORE', () => {
    const initial = performDeepResearch(createResearchReadyState());
    const quote = getResearchPurchase(initial, 'geology');
    const poor = { ...initial, imo: (quote.cost!).subtract(0.001) };
    expect(purchaseResearch(poor, 'geology')).toBe(poor);
    const exact = { ...initial, imo: quote.cost! };
    const after = purchaseResearch(exact, 'geology');
    expect(after.imo).toBeAmount(0);
    expect(after.runEarnedScore).toBeAmount(exact.runEarnedScore);
    expect(after.researchRanks.geology).toBe(1);
    expect(getProductionPerSecond(after)).toBeAmount(getProductionPerSecond(exact).multiply(2));
    expect(purchaseResearch(createResearchReadyState(), 'geology').researchRanks.geology).toBe(0);
  });

  it('multiplies only new equipment with resonance and allows full refund without reward or double refund', () => {
    let initial = performDeepResearch(createResearchReadyState());
    initial = purchaseEquipment(initial, 'veinExtractor', 1);
    initial = advanceGame(initial, 9000);
    let state = initial;
    for (const id of RESEARCH_IDS) for (let rank = 0; rank < 3; rank += 1) state = purchaseResearch(state, id);
    expect(state.researchRanks).toEqual({ geology: 3, resonance: 3 });
    expect(getProductionPerSecond(state)).toBeAmount((1 + 500_000 * 8) * 8);
    expect(purchaseResearch(state, 'resonance')).toBe(state);
    const reset = resetResearch(state);
    expect(reset).toEqual(initial);
    expect(resetResearch(reset)).toBe(reset);
    expect(() => createSave(reset, 0)).not.toThrow();
  });

  it('uses the same upgraded production online/offline, clips huge and fractional time at 1e12, and stops purchases', () => {
    let state = purchaseResearch(performDeepResearch(createResearchReadyState()), 'geology');
    state = purchaseEquipment(state, 'veinExtractor', 1);
    const offline = settleOffline(createSave(state, 0), 60_000);
    expect(offline.save.gameState).toEqual(advanceGame(state, 60));
    const near = { ...state, runEarnedScore: gn(1e12 - 0.125), imo: gn(100) };
    const capped = advanceGame(near, Number.MAX_VALUE);
    expect(capped.runEarnedScore).toBeAmount(1e12);
    expect(capped.imo).toBeAmount(100.125);
    expect(advanceGame(capped, 3600)).toBe(capped);
    for (const id of EQUIPMENT_IDS) expect(getPurchaseQuote(capped, id, 'MAX').quantity).toBe(0);
    for (const id of RESEARCH_IDS) expect(purchaseResearch(capped, id)).toBe(capped);
    expect(resetResearch(capped)).toBe(capped);
  });

  it.each(['balanced', 'efficient', 'priority'] as AutomationPolicy[])('matches fractional ticks and 24h offline for stage2 %s', (policy) => {
    let state = purchaseResearch(performDeepResearch(createResearchReadyState(true)), 'geology');
    state = configureAutomation(state, { ...state.automation, enabled: true, policy });
    const whole = advanceWithAutomation(state, 86400);
    expect(whole.purchaseCount).toBeLessThan(MAX_AUTOMATIC_PURCHASES);
    expect(whole.state.equipmentCounts.veinExtractor).toBeGreaterThan(0);
    expect(whole.state.equipmentCounts.concentrator).toBeGreaterThan(0);
    expect(whole.state.runEarnedScore).toBeAmount(1e12);
    expect(whole.state.researchRanks).toEqual(state.researchRanks);
    expect(settleOffline(createSave(state, 0), 48 * 3600_000).save.gameState).toEqual(whole.state);
    let split = state; let elapsed = 0;
    while (elapsed < 86400 && split.runEarnedScore.lt(1e12)) {
      const delta = Math.min(0.37, 86400 - elapsed);
      split = advanceGame(split, delta); elapsed += delta;
    }
    split = advanceGame(split, 86400 - elapsed);
    expect(split.equipmentCounts).toEqual(whole.state.equipmentCounts);
    expect(split.imo.subtract(whole.state.imo).abs()).toBeLessThanOrEqualAmount(0.01);
    expect(split.runEarnedScore.subtract(whole.state.runEarnedScore).abs()).toBeLessThanOrEqualAmount(0.01);
    expect(parseSave(serializeSave(createSave(split, 0))).gameState).toEqual(split);
  }, 20_000); // 0.37秒刻みの既存検証は共有Linux CIで約16.5秒。比較内容は維持する。
});

describe('v6 save and migrations', () => {
  it('migrates true v5 flags/order/carry/assets and appends enabled new devices without changing master', () => {
    const initial = createResearchReadyState(true);
    const ids = EQUIPMENT_IDS.filter((id) => !['veinExtractor', 'concentrator', 'rootRelay', 'coreChamber', 'originMiner', 'imoReactor'].includes(id));
    const { researchRanks: _ranks, ...old } = initial;
    const { deepResearchUnlocked: _unlock, ...permanent } = initial.permanent;
    const legacy = { ...old, permanent,
      equipmentCounts: Object.fromEntries(ids.map((id) => [id, id === 'refinery' ? 3 : 0])),
      automation: { ...old.automation, enabled: true, policy: 'priority', priority: [...ids].reverse(),
        equipment: Object.fromEntries(ids.map((id) => [id, id !== 'cart'])) }, automationRemainder: { score: gn(1e-9), imo: gn(0) } };
    const save = parseSave(stringifyTestSave({ saveVersion: 5, savedAt: 1234, gameState: legacy }));
    expect(save.saveVersion).toBe(SAVE_VERSION);
    expect(save.gameState.scoreCapStage).toBe(1);
    expect(save.gameState.imo).toBeAmount(initial.imo);
    expect(save.gameState.equipmentCounts.refinery).toBe(3);
    expect(save.gameState.automation).toEqual({ ...legacy.automation,
      equipment: { ...legacy.automation.equipment, veinExtractor: true, concentrator: true, rootRelay: true, coreChamber: true, originMiner: true, imoReactor: true }, priority: [...legacy.automation.priority, 'veinExtractor', 'concentrator', 'rootRelay', 'coreChamber', 'originMiner', 'imoReactor'] });
    expect(save.gameState.productionRemainder).toEqual({ score: legacy.automationRemainder.score, imo: legacy.automationRemainder.imo });
    expect(save.gameState.researchRanks).toEqual({ geology: 0, resonance: 0 });
    expect(save.gameState.permanent.deepResearchUnlocked).toBe(false);
  });

  it('round trips stage2 with research/automation/equipment and does not reapply offline earnings', () => {
    let state = purchaseResearch(performDeepResearch(createResearchReadyState(true)), 'geology');
    state = purchaseEquipment(state, 'veinExtractor', 1);
    const save = parseSave(serializeSave(createSave(state, 1234)));
    expect(save.gameState).toEqual(state);
    const settled = settleOffline(save, 987654);
    expect(settleOffline(settled.save, 987654).save).toEqual(settled.save);
  });

  it.each([
    (state: GameState) => ({ ...state, permanent: { ...state.permanent, deepResearchUnlocked: false } }),
    (state: GameState) => ({ ...state, runEarnedScore: gn(1e9 - 1), imo: gn(0) }),
    (state: GameState) => ({ ...state, researchRanks: { geology: 4, resonance: 0 } }),
    (state: GameState) => ({ ...state, researchRanks: { geology: 0.5, resonance: 0 } }),
    (state: GameState) => ({ ...state, researchRanks: undefined }),
    (state: GameState) => ({ ...state, runEarnedScore: gn(1e12 + 1) }),
  ])('rejects invalid stage2 permission/rank/numeric data %#', (change) => {
    const state = change(performDeepResearch(createResearchReadyState()));
    expect(() => parseSave(stringifyTestSave({ saveVersion: SAVE_VERSION, savedAt: 0, gameState: state }))).toThrow();
  });

  it('rejects new ownership and research in earlier stages and stage2 in legacy formats', () => {
    const state = createResearchReadyState();
    for (const id of ['veinExtractor', 'concentrator'] as const) expect(() => createSave({ ...state,
      equipmentCounts: { ...state.equipmentCounts, [id]: 1 } }, 0)).toThrow();
    expect(() => createSave({ ...state, researchRanks: { geology: 1, resonance: 0 } }, 0)).toThrow();
    for (const version of [1, 2, 3, 4, 5]) expect(() => parseSave(stringifyTestSave({ saveVersion: version, savedAt: 0,
      gameState: performDeepResearch(state) }))).toThrow();
  });
});
