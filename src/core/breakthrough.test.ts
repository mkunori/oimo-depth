import { withoutDepth } from '../test/depth';
import { testAmount as gn, stringifyTestSave } from '../test/amounts';

import { describe, expect, it } from 'vitest';
import { canBreakthrough, getBreakthrough, performBreakthrough } from './breakthrough';
import { advanceGame, getEquipmentAvailability, getProductionPerSecond, getPurchaseQuote, purchaseEquipment } from './game';
import { getPrestigeReward, prestigeGame, purchaseSkill } from './prestige';
import { createSave, parseSave, serializeSave, settleOffline, SAVE_VERSION } from './save';
import { getSkillPurchase } from './skills';
import { createInitialState } from './state';
import type { GameState } from './state';
import { getScoreCap } from '../data/scoreCaps';
import { createBreakthroughReadyState } from '../test/progress';

describe('first SCORE breakthrough', () => {
  it('requires skill prerequisites, multiple prestiges, and the full point cost', () => {
    let state = createInitialState();
    for (let run = 0; run < 4; run += 1) state = prestigeGame(advanceGame(state, 1e6));
    expect(purchaseSkill(state, 'breakthrough')).toBe(state);
    expect(getSkillPurchase(state.permanent, 'breakthrough').reason).toContain('前提');
    for (const id of ['harvest', 'harvest', 'harvest', 'discount'] as const) state = purchaseSkill(state, id);
    expect(getSkillPurchase(state.permanent, 'breakthrough').reason).toContain('転生5回');
    expect(purchaseSkill(state, 'breakthrough')).toBe(state);
    state = prestigeGame(advanceGame(state, 1e6));
    expect(state.permanent.unspentPoints).toBe(3);
    const bought = purchaseSkill(state, 'breakthrough');
    expect(bought.permanent.unspentPoints).toBe(0);
    expect(bought.permanent.skillRanks.breakthrough).toBe(1);
    expect(bought.scoreCapStage).toBe(0);
    expect(getScoreCap(bought)).toBeAmount(1e6);
    expect(canBreakthrough(bought)).toBe(false);
  });

  it('does not unlock by score alone or by the skill alone before reaching the cap', () => {
    const capped = advanceGame(createInitialState(), 1e6);
    expect(canBreakthrough(capped)).toBe(false);
    expect(performBreakthrough(capped)).toBe(capped);
    expect(getBreakthrough(capped).reason).toContain('心得');
    const ready = createBreakthroughReadyState();
    const almost = { ...ready, imo: gn(5), runEarnedScore: gn(1e6 - 1e-7) };
    expect(performBreakthrough(almost)).toBe(almost);
    expect(canBreakthrough(advanceGame(almost, 1))).toBe(true);
    expect(advanceGame(almost, 1).runEarnedScore).toBeAmount(1e6);
    expect(getPurchaseQuote(ready, 'worker', 'MAX')).toEqual({ quantity: 0, totalCost: gn(0) });
    expect(advanceGame(ready, 48 * 3600)).toBe(ready);
  });

  it('changes only the run cap, preserves immutable progress, and cannot execute twice', () => {
    const state = { ...createBreakthroughReadyState(), imo: gn(1234),
      equipmentCounts: { ...createInitialState().equipmentCounts, worker: 50, cart: 25, harvester: 10 } };
    Object.freeze(state.equipmentCounts); Object.freeze(state.permanent.skillRanks); Object.freeze(state.permanent); Object.freeze(state);
    const after = performBreakthrough(state);
    expect(after).toEqual({ ...state, scoreCapStage: 1, permanent: { ...state.permanent, rootCycleMaxUnlockedStage: 1, maxDiscoveredStage: 1 } });
    expect(after.equipmentCounts).toBe(state.equipmentCounts);
    expect(after.permanent.skillRanks).toBe(state.permanent.skillRanks);
    expect(after.runEarnedScore).toBeAmount(1e6);
    expect(getScoreCap(after)).toBeAmount(1e9);
    expect(getProductionPerSecond(after)).toBeAmount(getProductionPerSecond(state));
    expect(performBreakthrough(after)).toBe(after);
    expect(getBreakthrough(after).reason).toContain('地層研究');
    const continued = advanceGame(after, 1);
    expect(continued.runEarnedScore.subtract(after.runEarnedScore)).toBeCloseToAmount(getProductionPerSecond(after), 6);
    expect(continued.imo.subtract(after.imo)).toBeCloseToAmount(getProductionPerSecond(after), 6);
    expect(getEquipmentAvailability('deepDrill', after).unlocked).toBe(true);
  });

  it('unlocks higher purchases and clips safely at 1e9, including long/fractional time', () => {
    const state = performBreakthrough(createBreakthroughReadyState());
    const funded = advanceGame(state, 10_000_000);
    const purchased = purchaseEquipment(funded, 'deepDrill', 10);
    expect(purchased.equipmentCounts.deepDrill).toBeGreaterThan(0);
    expect(purchased.runEarnedScore).toBeAmount(funded.runEarnedScore);
    const near = { ...purchased, imo: gn(20), runEarnedScore: gn(1e9 - 0.125) };
    const capped = advanceGame(near, Number.MAX_VALUE);
    expect(capped.runEarnedScore).toBeAmount(1e9);
    expect(capped.imo).toBeAmount(20.125);
    expect(advanceGame(capped, 1e9)).toBe(capped);
    expect(getPurchaseQuote(capped, 'deepDrill', 'MAX').quantity).toBe(0);
    expect(canBreakthrough(capped)).toBe(false);
    expect(getPrestigeReward(capped)).toBe(3);
  });

  it('resets the cap on ordinary prestige while keeping permission and a free repeat path', () => {
    const expanded = performBreakthrough(createBreakthroughReadyState());
    const state = purchaseEquipment(advanceGame(expanded, 10_000_000), 'deepDrill', 1);
    const next = prestigeGame(state);
    expect(next.scoreCapStage).toBe(0);
    expect(next.equipmentCounts).toEqual(createInitialState().equipmentCounts);
    expect(next.permanent.skillRanks).toEqual(state.permanent.skillRanks);
    expect(next.permanent.prestigeCount).toBe(6);
    const atCap = advanceGame(next, 1e6);
    const repeated = performBreakthrough(atCap);
    expect(repeated.scoreCapStage).toBe(1);
    expect(repeated.permanent).toBe(atCap.permanent);
    expect(repeated.permanent.unspentPoints).toBe(2);
  });

  it.each([-1, 0.5, 2, NaN, Infinity, undefined])('rejects unsupported or missing stage %s', (scoreCapStage) => {
    const bad = { ...createBreakthroughReadyState(), scoreCapStage } as GameState;
    expect(() => advanceGame(bad, 0)).toThrow(RangeError);
    expect(() => performBreakthrough(bad)).toThrow(RangeError);
    expect(() => createSave(bad, 0)).toThrow();
  });

  it('rejects forged permission, premature stages, and SCORE above the current cap', () => {
    const unlocked = createBreakthroughReadyState();
    const invalid = [
      { ...createInitialState(), scoreCapStage: 1 },
      { ...unlocked, scoreCapStage: 1, imo: gn(0), runEarnedScore: gn(999999) },
      { ...unlocked, runEarnedScore: gn(1000001) },
      { ...performBreakthrough(unlocked), runEarnedScore: gn(1000000001) },
      { ...unlocked, permanent: { ...unlocked.permanent, prestigeCount: 4 } },
      { ...unlocked, permanent: { ...unlocked.permanent, skillRanks: { ...unlocked.permanent.skillRanks, harvest: 2 } } },
    ];
    for (const state of invalid) expect(() => createSave(state as GameState, 0)).toThrow();
  });
});

describe('breakthrough persistence and migration', () => {
  it.each([1, 2, 3])('migrates a true v%s save without buying permission or changing the cap', (version) => {
    const current = createBreakthroughReadyState();
    const legacy = { imo: gn(123.5), runEarnedScore: gn(1e6), equipmentCounts: { worker: 50, cart: 25, harvester: 10, ...(version === 3 ? { deepDrill: 0, refinery: 0 } : {}) },
      ...(version >= 2 ? { runStartingImo: gn(0), permanent: { prestigeCount: 5, unspentPoints: 3, skillRanks: { harvest: 3, discount: 1, startingImo: 0 } } } : {}) };
    const save = parseSave(stringifyTestSave({ saveVersion: version, savedAt: 1234, gameState: legacy }));
    expect(save.saveVersion).toBe(SAVE_VERSION);
    expect(save.savedAt).toBe(1234);
    expect(save.gameState.imo).toBeAmount(123.5);
    expect(save.gameState.runEarnedScore).toBeAmount(1e6);
    expect(save.gameState.equipmentCounts.worker).toBe(50);
    expect(save.gameState.scoreCapStage).toBe(0);
    expect(save.gameState.permanent.skillRanks.breakthrough).toBe(0);
    expect(canBreakthrough(save.gameState)).toBe(false);
    if (version >= 2) {
      expect(save.gameState.permanent.prestigeCount).toBe(5);
      expect(save.gameState.permanent.unspentPoints).toBe(3);
      expect(withoutDepth(purchaseSkill(save.gameState, 'breakthrough').permanent)).toEqual(withoutDepth(current.permanent));
    }
  });

  it('round trips expanded equipment and settles offline once at the dynamic cap', () => {
    const state = purchaseEquipment(advanceGame(performBreakthrough(createBreakthroughReadyState()), 10_000_000), 'deepDrill', 10);
    const save = createSave(state, 1000);
    const restored = parseSave(serializeSave(save));
    expect(restored).toEqual(save);
    const short = settleOffline(restored, 61_000);
    expect(short.save.gameState).toEqual(advanceGame(state, 60));
    expect(short.save.gameState.runEarnedScore).toBeGreaterThanAmount(1e6);
    const capped = settleOffline(restored, 1000 + 48 * 3_600_000);
    expect(capped.report.appliedSeconds).toBe(86_400);
    expect(capped.save.gameState.runEarnedScore).toBeAmount(1e9);
    expect(settleOffline(capped.save, capped.save.savedAt).report.earnedImo).toBeAmount(0);
  });

  it('requires both new v4 fields and rejects legacy data that claims breakthrough', () => {
    const ready = createBreakthroughReadyState();
    const { scoreCapStage: _stage, ...missingStage } = ready;
    const { breakthrough: _rank, ...ranks } = ready.permanent.skillRanks;
    for (const state of [missingStage, { ...ready, permanent: { ...ready.permanent, skillRanks: ranks } }]) {
      expect(() => parseSave(stringifyTestSave({ saveVersion: 4, savedAt: 0, gameState: state }))).toThrow();
    }
    for (const version of [1, 2, 3]) {
      expect(() => parseSave(stringifyTestSave({ saveVersion: version, savedAt: 0, gameState: performBreakthrough(ready) }))).toThrow();
    }
  });
});
