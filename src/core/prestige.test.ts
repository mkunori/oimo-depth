import { testAmount as gn } from '../test/amounts';

import { describe, expect, it } from 'vitest';
import { advanceGame, getEquipmentPrice, getProductionPerSecond, getPurchaseQuote, purchaseEquipment } from './game';
import { getPrestigeReward, getNextPrestigeReward, prestigeGame, purchaseSkill } from './prestige';
import { getSkillPointsSpent } from './prestigePoints';
import { createResearchReadyState, createRootConnectionReadyState, createRootRebirthReadyState, buyTestEnhancements, completeAnalyzedRootCycle } from '../test/progress';
import { performBreakthrough } from './breakthrough';
import { performDeepResearch } from './research';
import { performRootRebirth } from './root';
import { createSave, parseSave, serializeSave } from './save';
import { getSkillBonuses, getSkillPurchase } from './skills';
import { createInitialState } from './state';
import type { GameState } from './state';
import type { SkillId } from '../data/skills';

function atScore(score: number): GameState {
  return { ...createInitialState(), imo: gn(score), runEarnedScore: gn(score) };
}

function earnedPoints(runs: number): GameState {
  let state = createInitialState();
  for (let index = 0; index < runs; index += 1) state = prestigeGame(advanceGame(state, 1_000_000));
  return state;
}

describe('prestige loop', () => {
  it('uses actual SCORE at higher reward boundaries and balances the ledger without double claiming', () => {
    const cases = [
      [atScore(1e6), 2], [createResearchReadyState(), 3],
      [createRootConnectionReadyState(), 4], [createRootRebirthReadyState(), 6],
    ] as const;
    for (const [state, reward] of cases) {
      const below = { ...state, imo: gn(0), runEarnedScore: state.runEarnedScore.multiply(1 - 1e-12) };
      expect(getPrestigeReward(below)).toBe(reward - 1);
      expect(getNextPrestigeReward(below)?.score).toBeAmount(state.runEarnedScore);
      const emptyBalance = { ...state, imo: gn(0) }, next = prestigeGame(emptyBalance);
      expect(getPrestigeReward(emptyBalance)).toBe(reward);
      expect(next.permanent.lifetimePrestigePointsEarned).toBe(state.permanent.lifetimePrestigePointsEarned + reward);
      expect(next.permanent.unspentPoints).toBe(state.permanent.unspentPoints + reward);
      expect(getSkillPointsSpent(next.permanent.skillRanks) + next.permanent.unspentPoints + next.permanent.pointsLostByDeepResearch).toBe(next.permanent.lifetimePrestigePointsEarned);
      expect(getPrestigeReward(next)).toBe(0); expect(prestigeGame(next)).toBe(next);
    }
  });

  it('unlocks higher ranks per ROOT cycle, pays nonlinear grants only on reset, and keeps paid grants through analysis', () => {
    let state = createRootRebirthReadyState();
    state = prestigeGame(state);
    state = buyTestEnhancements(state, { harvest: 7, discount: 5, startingImo: 6 });
    const paid = prestigeGame(advanceGame(state, Number.MAX_VALUE));
    expect(paid.runStartingImo).toBeAmount(500000); expect(paid.runEarnedScore).toBeAmount(0);
    expect(getSkillBonuses(paid.permanent).productionMultiplier).toBe(4.5);
    expect(getSkillBonuses(paid.permanent).equipmentDiscountPercent).toBe(50);
    expect(parseSave(serializeSave(createSave(paid, 0))).gameState).toEqual(paid);
    const root = performRootRebirth(completeAnalyzedRootCycle(paid));
    expect(root.permanent.rootCycleMaxUnlockedStage).toBe(0);
    expect(root.permanent.skillRanks.startingImo).toBe(6);
    expect(getSkillPurchase(root.permanent, 'startingImo').canPurchase).toBe(false);
    expect(root.runStartingImo).toBeAmount(500000);
    const ready = advanceGame(performBreakthrough(advanceGame(root, Number.MAX_VALUE)), Number.MAX_VALUE);
    const analyzed = performDeepResearch(ready);
    expect(analyzed.runStartingImo).toBeAmount(500000);
    expect(analyzed.imo).toBeAmount(ready.imo);
    expect(analyzed.permanent.pointsLostByDeepResearch).toBe(ready.permanent.pointsLostByDeepResearch + 36);
    expect(parseSave(serializeSave(createSave(analyzed, 0))).gameState).toEqual(analyzed);
    expect(() => createSave({ ...paid, permanent: { ...paid.permanent, unspentPoints: paid.permanent.unspentPoints + 1 } }, 0)).toThrow();
    const first = performDeepResearch(createResearchReadyState());
    expect(first.permanent.pointsLostByDeepResearch).toBe(7);
    expect(first.permanent.unspentPoints).toBe(0);
  });
  it.each([[0, 0], [99_999.9, 0], [100_000, 1], [999_999.9, 1], [1_000_000, 2]])(
    'previews and grants %s SCORE -> %s points', (score, points) => {
      const state = atScore(score);
      expect(getPrestigeReward(state)).toBe(points);
      const next = prestigeGame(state);
      expect(next.permanent.unspentPoints).toBe(points);
      expect(next.permanent.prestigeCount).toBe(points > 0 ? 1 : 0);
      if (points === 0) expect(next).toBe(state);
      else expect(next.runEarnedScore).toBeAmount(0);
    },
  );

  it('resets only the run, preserves skills and unspent points, and cannot claim twice', () => {
    let state = purchaseSkill(earnedPoints(2), 'harvest');
    state = purchaseEquipment({ ...state, imo: gn(100_000), runEarnedScore: gn(100_000) }, 'cart', 10);
    Object.freeze(state.permanent.skillRanks);
    Object.freeze(state.permanent);
    Object.freeze(state.equipmentCounts);
    Object.freeze(state);
    const next = prestigeGame(state);

    expect(next.imo).toBeAmount(0);
    expect(next.runEarnedScore).toBeAmount(0);
    expect(next.equipmentCounts).toEqual(createInitialState().equipmentCounts);
    expect(next.permanent.skillRanks).toEqual(state.permanent.skillRanks);
    expect(next.permanent.unspentPoints).toBe(state.permanent.unspentPoints + 1);
    expect(next.permanent.prestigeCount).toBe(3);
    expect(getProductionPerSecond(next)).toBeAmount(1.5);
    expect(prestigeGame(next)).toBe(next);
    expect(state.runEarnedScore).toBeAmount(100_000);
  });

  it('returns from the cap to a progressing next run', () => {
    const next = prestigeGame(atScore(1_000_000));
    expect(advanceGame(next, 1).runEarnedScore).toBeAmount(1);
    expect(next.permanent.unspentPoints).toBe(2);
  });
});

describe('basic skill tree', () => {
  it('rejects insufficient points and unmet prerequisites without changing state', () => {
    const empty = createInitialState();
    expect(purchaseSkill(empty, 'harvest')).toBe(empty);
    expect(getSkillPurchase(empty.permanent, 'harvest').reason).toContain('足りません');
    const state = earnedPoints(1);
    expect(purchaseSkill(state, 'discount')).toBe(state);
    expect(purchaseSkill(state, 'startingImo')).toBe(state);
    expect(getSkillPurchase(state.permanent, 'discount').reason).toContain('前提');
  });

  it('uses rising rank costs, rejects maximum ranks, and spends only points', () => {
    let state = earnedPoints(3);
    const before = state;
    for (const cost of [1, 2, 3]) {
      expect(getSkillPurchase(state.permanent, 'harvest').cost).toBe(cost);
      state = purchaseSkill(state, 'harvest');
    }
    expect(state.permanent.unspentPoints).toBe(0);
    expect(state.permanent.skillRanks.harvest).toBe(3);
    expect(purchaseSkill(state, 'harvest')).toBe(state);
    expect(getSkillPurchase(state.permanent, 'harvest').reason).toContain('最大ランク');
    expect(state.imo).toBeAmount(before.imo);
    expect(state.runEarnedScore).toBeAmount(before.runEarnedScore);
    expect(state.permanent.prestigeCount).toBe(before.permanent.prestigeCount);
  });

  it('immediately increases production of both base harvest and equipment', () => {
    const before = purchaseEquipment({ ...earnedPoints(1), imo: gn(100), runEarnedScore: gn(100) }, 'worker', 1);
    const after = purchaseSkill(before, 'harvest');
    expect(getProductionPerSecond(before)).toBeAmount(2);
    expect(getProductionPerSecond(after)).toBeAmount(3);
    expect(advanceGame(after, 1_000).runEarnedScore.subtract(after.runEarnedScore)).toBeAmount((advanceGame(before, 1_000).runEarnedScore.subtract(before.runEarnedScore)).multiply(1.5));
    expect(advanceGame(after, 1_000_000).runEarnedScore).toBeAmount(1_000_000);
  });

  it('discounts every unit before rounding, with identical bulk and individual purchases', () => {
    let skilled = purchaseSkill(earnedPoints(2), 'harvest');
    skilled = purchaseSkill(skilled, 'discount');
    skilled = purchaseSkill(skilled, 'discount');
    expect(getSkillBonuses(skilled.permanent).equipmentDiscountPercent).toBe(20);
    expect(getEquipmentPrice('worker', 0, skilled.permanent)).toBeAmount(8);
    expect(getEquipmentPrice('worker', 1, skilled.permanent)).toBeAmount(10);
    const state = { ...skilled, imo: gn(1_000), runEarnedScore: gn(1_000) };
    for (const mode of [1, 10, 'MAX'] as const) {
      const quote = getPurchaseQuote(state, 'worker', mode);
      let individual = state;
      for (let index = 0; index < quote.quantity; index += 1) individual = purchaseEquipment(individual, 'worker', 1);
      expect(purchaseEquipment(state, 'worker', mode)).toEqual(individual);
    }
  });

  it('grants starting imo only on the next prestige and never counts it as earned SCORE', () => {
    const withHarvest = purchaseSkill(earnedPoints(2), 'harvest');
    const skilled = purchaseSkill(withHarvest, 'startingImo');
    expect(skilled.imo).toBeAmount(0);
    const next = prestigeGame({ ...skilled, imo: gn(100_000), runEarnedScore: gn(100_000) });
    expect(next.imo).toBeAmount(50);
    expect(next.runStartingImo).toBeAmount(50);
    expect(next.runEarnedScore).toBeAmount(0);
    expect(getPrestigeReward(next)).toBe(0);
    const purchased = purchaseEquipment(next, 'worker', 'MAX');
    expect(purchased.imo).toBeGreaterThanOrEqualAmount(0);
    expect(purchased.runEarnedScore).toBeAmount(0);
    const capped = advanceGame(next, 1_000_000);
    expect(capped.runEarnedScore).toBeAmount(1_000_000);
    expect(capped.imo).toBeAmount(1_000_050);
  });

  it.each(['unknown', '__proto__'])('rejects unknown skill %s', (id) => {
    expect(() => purchaseSkill(earnedPoints(1), id as SkillId)).toThrow(RangeError);
  });

  it.each([
    { prestigeCount: -1 },
    { prestigeCount: NaN },
    { unspentPoints: -1 },
    { unspentPoints: Infinity },
    { unspentPoints: 0.5 },
    { unspentPoints: 100 },
    { skillRanks: { automation: 0, breakthrough: 0, harvest: 4, discount: 0, startingImo: 0 } },
    { skillRanks: { automation: 0, breakthrough: 0, harvest: -1, discount: 0, startingImo: 0 } },
    { skillRanks: { automation: 0, breakthrough: 0, harvest: NaN, discount: 0, startingImo: 0 } },
    { skillRanks: { automation: 0, breakthrough: 0, harvest: 0, discount: 1, startingImo: 0 } },
  ])('rejects malformed permanent progression %#', (patch) => {
    const state = earnedPoints(1);
    const bad = { ...state, permanent: { ...state.permanent, ...patch } };
    expect(() => getPrestigeReward(bad)).toThrow(RangeError);
    expect(() => purchaseSkill(bad, 'harvest')).toThrow(RangeError);
    expect(() => getProductionPerSecond(bad)).toThrow(RangeError);
  });
});
