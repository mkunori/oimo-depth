import { testAmount as gn, stringifyTestSave } from '../test/amounts';

import { describe, expect, it } from 'vitest';
import { createResearchReadyState, createBreakthroughReadyState } from '../test/progress';
import { getDeepResearch, performDeepResearch, getResearchPurchase, purchaseResearch, resetResearch } from './research';
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
  it('requires stage1 SCORE1e9, preserves progress and unlocks once without any funds', () => {
    for (const state of [createInitialState(), createBreakthroughReadyState(), performBreakthrough(createBreakthroughReadyState())]) {
      expect(getDeepResearch(state).canResearch).toBe(false);
      expect(performDeepResearch(state)).toBe(state);
    }
    const before = { ...createResearchReadyState(), imo: gn(0) };
    Object.freeze(before.permanent); Object.freeze(before.equipmentCounts); Object.freeze(before);
    const after = performDeepResearch(before);
    expect(after).toEqual({ ...before, scoreCapStage: 2, permanent: { ...before.permanent, deepResearchUnlocked: true } });
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
    expect(performDeepResearch(repeat)).toEqual({ ...repeat, scoreCapStage: 2, permanent: repeat.permanent });
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
    initial = advanceGame(initial, 3600);
    let state = initial;
    for (const id of RESEARCH_IDS) for (let rank = 0; rank < 3; rank += 1) state = purchaseResearch(state, id);
    expect(state.researchRanks).toEqual({ geology: 3, resonance: 3 });
    expect(getProductionPerSecond(state)).toBeAmount((2.5 + 500_000 * 2.5 * 8) * 8);
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
  }, 15000);
});

describe('v6 save and migrations', () => {
  it('migrates true v5 flags/order/carry/assets and appends enabled new devices without changing master', () => {
    const initial = createResearchReadyState(true);
    const ids = EQUIPMENT_IDS.filter((id) => id !== 'veinExtractor' && id !== 'concentrator');
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
      equipment: { ...legacy.automation.equipment, veinExtractor: true, concentrator: true }, priority: [...legacy.automation.priority, 'veinExtractor', 'concentrator'] });
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
