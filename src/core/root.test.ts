import { describe, expect, it } from 'vitest';
import { createRootRebirthReadyState } from '../test/progress';
import { createInitialState } from './state';
import type { GameState } from './state';
import { advanceGame, advanceWithAutomation, getEquipmentPurchaseGain, getProductionPerSecond, purchaseEquipment, getEquipmentPrice } from './game';
import { getRootRebirth, getRootUpgradePurchase, performRootRebirth, purchaseRootUpgrade } from './root';
import { prestigeGame } from './prestige';
import { performBreakthrough } from './breakthrough';
import { performDeepResearch } from './research';
import { performRootConnection } from './rootConnection';
import { performOriginAnalysis } from './origin';
import { createSave, parseSave, serializeSave, settleOffline } from './save';
import { getDigPower } from './excavation';
import { gn } from './numbers';

function revisit(initial: GameState) {
  let state = advanceGame(initial, Number.MAX_VALUE);
  state = advanceGame(performBreakthrough(state), Number.MAX_VALUE);
  state = advanceGame(performDeepResearch(state), Number.MAX_VALUE);
  state = advanceGame(performRootConnection(state), Number.MAX_VALUE);
  state = performOriginAnalysis(state);
  return advanceGame(purchaseEquipment(advanceGame(state, 1e15), 'originMiner', 1), Number.MAX_VALUE);
}

describe('ROOT rebirth', () => {
  it('keeps permanent assets and normal points, resets only the run, and cannot double claim or deadlock on later deep analyses', () => {
    const empty = createInitialState();
    expect(getRootRebirth(empty).canRebirth).toBe(false); expect(performRootRebirth(empty)).toBe(empty);
    const before = createRootRebirthReadyState(), normal = prestigeGame(before), root = performRootRebirth(before);
    expect(normal.permanent.rootRebirthCount).toBe(0);
    expect(normal.permanent.prestigeCount).toBe(before.permanent.prestigeCount + 1);
    expect(normal.permanent.unspentPoints).toBe(before.permanent.unspentPoints + 2);
    expect(root).toEqual({ ...createInitialState(), automation: before.automation, permanent: { ...before.permanent,
      rootRebirthCount: 1, totalRootCrystalsEarned: 1, unspentRootCrystals: 1, equipmentSystemUnlocked: true, gearDiscovered: { ...before.permanent.gearDiscovered, shovel: true } } });
    expect(getProductionPerSecond(root)).toBeAmount(3);
    expect(performRootRebirth(root)).toBe(root);
    let next = root;
    for (let count = 2; count <= 4; count += 1) {
      next = performRootRebirth(revisit(next));
      expect(next.permanent.rootRebirthCount).toBe(count);
      expect(next.permanent.deepResearchCount).toBe(count);
      expect(next.permanent.unspentRootCrystals).toBe(count);
      expect(next.permanent.prestigeCount).toBe(before.permanent.prestigeCount);
      expect(next.permanent.unspentPoints).toBe(before.permanent.unspentPoints);
      expect(next.permanent.depthMeters).toBeGreaterThanOrEqual(before.permanent.depthMeters);
      expect(next.postDeepResearchSkillLock).toBe(false);
      expect(getProductionPerSecond(next)).toBeAmount(3); // first bonus is not 3^count
    }
  });

  it('spends only crystals, distinguishes the first choices, and uses persistent production/discount/late/dig effects in core caches', () => {
    const root = performRootRebirth(createRootRebirthReadyState());
    expect(getRootUpgradePurchase(root, 'adaptation').canPurchase).toBe(false);
    expect(purchaseRootUpgrade(root, 'adaptation')).toBe(root);
    const harvest = purchaseRootUpgrade(root, 'blessing'), memory = purchaseRootUpgrade(root, 'memory');
    expect(harvest.permanent.unspentRootCrystals).toBe(0);
    expect(harvest.permanent.totalRootCrystalsSpent).toBe(1);
    expect(harvest.imo).toBeAmount(root.imo); expect(harvest.permanent.unspentPoints).toBe(root.permanent.unspentPoints);
    expect(getProductionPerSecond(harvest)).toBeAmount(4.5); expect(getProductionPerSecond(memory)).toBeAmount(3);
    expect(getEquipmentPrice('cart', 0, memory.permanent)).toBeAmount(90);
    expect(memory.runStartingImo).toBeAmount(0); // no retroactive starting grant
    const normal = prestigeGame(advanceGame(memory, Number.MAX_VALUE));
    expect(normal.runStartingImo).toBeAmount(100); expect(normal.imo).toBeAmount(100); expect(normal.runEarnedScore).toBeAmount(0);
    expect(purchaseRootUpgrade(harvest, 'blessing')).toBe(harvest);
    const second = performRootRebirth(revisit(harvest)), adapted = purchaseRootUpgrade(second, 'adaptation');
    expect(adapted.permanent.rootUpgradeRanks.adaptation).toBe(1);
    expect(getDigPower(adapted)).toBeCloseTo(getDigPower(second) * 1.5, 10);
    const late = performDeepResearch(advanceGame(performBreakthrough(advanceGame(adapted, Number.MAX_VALUE)), Number.MAX_VALUE));
    expect(getEquipmentPurchaseGain('veinExtractor', late)).toBeAmount(gn(500000).multiply(4.5 * 1.5));
    expect(parseSave(serializeSave(createSave(adapted, 0))).gameState).toEqual(adapted);
  });

  it('never automates ROOT, preserves offline/reset behavior and settles a saved ROOT run once', () => {
    const ready = createRootRebirthReadyState();
    expect(settleOffline(createSave(ready, 0), 48 * 3600_000).save.gameState).toEqual(ready);
    const root = performRootRebirth(ready), enabled = { ...root, automation: { ...root.automation, enabled: true } };
    const whole = advanceWithAutomation(enabled, 86400).state;
    const settled = settleOffline(parseSave(serializeSave(createSave(enabled, 0))), 86400_000);
    expect(settled.save.gameState).toEqual(whole);
    expect(whole.runEarnedScore).toBeAmount(1e6); expect(whole.permanent.rootRebirthCount).toBe(1);
    expect(whole.permanent.unspentRootCrystals).toBe(1);
    expect(whole.permanent.depthMeters).toBeGreaterThan(root.permanent.depthMeters);
    expect(settleOffline(settled.save, 86400_000).save.gameState).toEqual(whole);
    expect(prestigeGame(whole).permanent.rootRebirthCount).toBe(1);
  });

  it('migrates v11 without changing assets/history/time and rejects forged crystal ledgers or unlocks', () => {
    const ready = createRootRebirthReadyState();
    const old = JSON.parse(serializeSave(createSave(ready, 1234)));
    old.saveVersion = 11;
    for (const key of ['rootRebirthCount', 'unspentRootCrystals', 'totalRootCrystalsEarned', 'totalRootCrystalsSpent', 'rootUpgradeRanks', 'equipmentSystemUnlocked']) delete old.gameState.permanent[key];
    const migrated = parseSave(JSON.stringify(old));
    expect(migrated.savedAt).toBe(1234); expect(migrated.gameState).toEqual(ready);
    const root = performRootRebirth(ready);
    for (const change of [
      { rootRebirthCount: -1 }, { unspentRootCrystals: 2 }, { totalRootCrystalsEarned: 2 }, { totalRootCrystalsSpent: 1 },
      { equipmentSystemUnlocked: false }, { rootUpgradeRanks: { blessing: 0, memory: 0, adaptation: 1 } },
    ]) expect(() => createSave({ ...root, permanent: { ...root.permanent, ...change } }, 0)).toThrow();
    expect(() => createSave({ ...ready, permanent: { ...ready.permanent, equipmentSystemUnlocked: true } }, 0)).toThrow();
    expect(() => createSave({ ...ready, permanent: { ...root.permanent } }, 0)).toThrow(); // no new analysis in this ROOT cycle
  });
});
