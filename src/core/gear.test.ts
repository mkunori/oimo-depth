import { describe, expect, it } from 'vitest';
import { GEAR_IDS, createEmptyGear } from '../data/gear';
import { createRootRebirthReadyState } from '../test/progress';
import { getGearUnlock, unlockGear } from './gear';
import { getGearMultiplier, getGearSpend, getSpendableScore } from './gearProgress';
import { performRootRebirth } from './root';
import { advanceGame, advanceWithAutomation, getEquipmentPurchaseGain, getProductionPerSecond } from './game';
import { prestigeGame } from './prestige';
import { performBreakthrough } from './breakthrough';
import { performDeepResearch } from './research';
import { performRootConnection } from './rootConnection';
import { performOriginAnalysis } from './origin';
import { createSave, parseSave, serializeSave, settleOffline } from './save';
import { gn, approximatelyEqual } from './numbers';

function root() { return performRootRebirth(createRootRebirthReadyState()); }
function late(rootCount = 3) {
  let state = root();
  state = { ...state, permanent: { ...state.permanent, rootRebirthCount: rootCount, deepResearchCount: rootCount,
    totalRootCrystalsEarned: rootCount, unspentRootCrystals: rootCount } };
  state = performBreakthrough(advanceGame(state, Number.MAX_VALUE));
  state = performDeepResearch(advanceGame(state, Number.MAX_VALUE));
  state = performRootConnection(advanceGame(state, Number.MAX_VALUE));
  return performOriginAnalysis(advanceGame(state, Number.MAX_VALUE));
}

describe('permanent gear and SCORE spending', () => {
  it('debits only spendable SCORE once, gates ROOT/stage and keeps unpaid discoveries across prestige', () => {
    const beforeRoot = createRootRebirthReadyState();
    expect(unlockGear(beforeRoot, 'shovel')).toBe(beforeRoot);
    const initial = root();
    expect(initial.permanent.gearDiscovered).toEqual({ ...createEmptyGear(), shovel: true });
    const low = { ...initial, imo: gn(123), runEarnedScore: gn(1e5 - 1) };
    expect(unlockGear(low, 'shovel')).toBe(low);
    const funded = { ...low, runEarnedScore: gn(1e5) }, after = unlockGear(funded, 'shovel');
    expect(after).toEqual({ ...funded, scoreSpentThisRun: gn(1e5), gearPurchasedThisRun: ['shovel'],
      permanent: { ...funded.permanent, gearUnlocked: { ...createEmptyGear(), shovel: true } } });
    expect(getSpendableScore(after)).toBeAmount(0); expect(unlockGear(after, 'shovel')).toBe(after);
    const stage1 = performBreakthrough(advanceGame(after, Number.MAX_VALUE));
    expect(stage1.permanent.gearDiscovered.lens).toBe(true);
    expect(stage1.permanent.gearDiscovered.drillBit).toBe(false);
    const reset = prestigeGame(stage1);
    expect(reset.scoreSpentThisRun).toBeAmount(0); expect(reset.gearPurchasedThisRun).toEqual([]);
    expect(reset.permanent.gearUnlocked.shovel).toBe(true); expect(reset.permanent.gearDiscovered.lens).toBe(true);
    expect(getGearUnlock(reset, 'lens').canUnlock).toBe(false);
    const capped = { ...late(1), runEarnedScore: gn(1e18) };
    expect(getGearUnlock(capped, 'compass').canUnlock).toBe(false);
    expect(unlockGear(capped, 'rootCore')).toBe(capped);
  });

  it('stacks every passive, keeps huge receipts independent of purchase order and never restarts a capped run', () => {
    const base = { ...late(), imo: gn(1e17), runEarnedScore: gn(1e18) };
    const all = GEAR_IDS.reduce(unlockGear, base), reverse = [...GEAR_IDS].reverse().reduce(unlockGear, base);
    expect(all.scoreSpentThisRun).toBeAmount(getGearSpend(GEAR_IDS));
    expect(all.scoreSpentThisRun).toBeAmount('gn1:1:1:17.000434511774017'); // portable canonical total
    expect(reverse).toEqual(all);
    expect(all.imo).toBeAmount(base.imo); expect(all.runEarnedScore).toBeAmount(base.runEarnedScore);
    expect(all.permanent.unspentRootCrystals).toBe(base.permanent.unspentRootCrystals);
    expect(getGearMultiplier(all.permanent)).toBeCloseTo(1.05 ** 4 * 1.10, 12);
    expect(approximatelyEqual(getProductionPerSecond(all), getProductionPerSecond(base).multiply(getGearMultiplier(all.permanent)), 1e-9, 1e-12)).toBe(true);
    expect(advanceGame(all, 86400)).toBe(all);
    expect(settleOffline(createSave(all, 0), 48 * 3600_000).save.gameState).toEqual(all);
    const next = performRootRebirth(all);
    expect(next.scoreSpentThisRun).toBeAmount(0); expect(next.gearPurchasedThisRun).toEqual([]);
    expect(next.permanent.gearUnlocked).toEqual(all.permanent.gearUnlocked);
    expect(next.permanent.gearDiscovered).toEqual(all.permanent.gearDiscovered);
    expect(next.permanent.depthMeters).toBe(all.permanent.depthMeters);
  });

  it('uses the new multiplier in equipment gains, automatic purchases and saved offline settlement', () => {
    const initial = root();
    const funded = { ...initial, imo: gn(1e5), runEarnedScore: gn(1e5), automation: { ...initial.automation, enabled: true } };
    const geared = unlockGear(funded, 'shovel');
    expect(getEquipmentPurchaseGain('cart', geared)).toBeAmount(getEquipmentPurchaseGain('cart', funded).multiply(1.05));
    const whole = advanceWithAutomation(geared, 86400).state;
    const loaded = parseSave(serializeSave(createSave(geared, 0)));
    expect(loaded.gameState).toEqual(geared);
    expect(settleOffline(loaded, 86400_000).save.gameState).toEqual(whole);
    expect(whole.scoreSpentThisRun).toBeAmount(1e5); expect(whole.runEarnedScore).toBeAmount(1e6);
    expect(whole.permanent.gearUnlocked.shovel).toBe(true);
    expect(whole.permanent.rootRebirthCount).toBe(1);
  });

  it('migrates v12 without inventing purchases/history and rejects invalid receipts, flags or spend', () => {
    const source = root(), raw = JSON.parse(serializeSave(createSave(source, 1234)));
    raw.saveVersion = 12; delete raw.gameState.scoreSpentThisRun; delete raw.gameState.gearPurchasedThisRun;
    delete raw.gameState.permanent.gearUnlocked; delete raw.gameState.permanent.gearDiscovered;
    const migrated = parseSave(JSON.stringify(raw));
    expect(migrated.savedAt).toBe(1234); expect(migrated.gameState).toEqual(source);
    const funded = { ...source, imo: gn(1e5), runEarnedScore: gn(1e5) }, bought = unlockGear(funded, 'shovel');
    for (const change of [
      { scoreSpentThisRun: gn(-1) }, { scoreSpentThisRun: gn(1e5 + 1) }, { scoreSpentThisRun: gn(1e5 - 1) },
      { gearPurchasedThisRun: [] }, { gearPurchasedThisRun: ['shovel', 'shovel'] },
      { permanent: { ...bought.permanent, gearUnlocked: createEmptyGear() } },
      { permanent: { ...bought.permanent, gearDiscovered: createEmptyGear() } },
      { permanent: { ...bought.permanent, gearDiscovered: { ...bought.permanent.gearDiscovered, compass: true } } },
    ]) expect(() => createSave({ ...bought, ...change } as typeof bought, 0)).toThrow();
    expect(() => createSave({ ...createRootRebirthReadyState(), permanent: { ...createRootRebirthReadyState().permanent,
      gearUnlocked: { ...createEmptyGear(), shovel: true }, gearDiscovered: { ...createEmptyGear(), shovel: true } } }, 0)).toThrow();
  });
});
