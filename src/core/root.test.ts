import { withLegacyRefunds, createLegacyRootState } from '../test/progress';
import { describe, expect, it } from 'vitest';
import { createRootRebirthReadyState, createNextRootAnalysisReadyState, completeAnalyzedRootCycle } from '../test/progress';
import { createInitialState } from './state';
import type { GameState } from './state';
import { advanceGame, advanceWithAutomation, getEquipmentPurchaseGain, getProductionPerSecond, getEquipmentPrice } from './game';
import { getRootRebirth, getRootUpgradePurchase, performRootRebirth, purchaseRootUpgrade } from './root';
import { prestigeGame } from './prestige';
import { performDeepResearch } from './research';
import { createSave, parseSave, serializeSave, settleOffline } from './save';
import { getDigPower } from './excavation';
import { gn } from './numbers';

function revisit(initial: GameState) {
  return completeAnalyzedRootCycle(performDeepResearch(createNextRootAnalysisReadyState(initial)));
}

describe('ROOT rebirth', () => {
  it('resets lower assets atomically, keeps lifetime history and rebuilds across multiple ROOTs', () => {
    const empty = createInitialState();
    expect(getRootRebirth(empty).canRebirth).toBe(false); expect(performRootRebirth(empty)).toBe(empty);
    const before = createRootRebirthReadyState(), normal = prestigeGame(before), root = performRootRebirth(before);
    expect(normal.permanent.rootRebirthCount).toBe(0);
    expect(normal.permanent.prestigeCount).toBe(before.permanent.prestigeCount + 1);
    expect(normal.permanent.unspentPoints).toBe(before.permanent.unspentPoints + 6);
    expect(root.permanent.prestigeCount).toBe(0); expect(root.permanent.unspentPoints).toBe(0);
    expect(root.permanent.skillRanks).toEqual(empty.permanent.skillRanks);
    expect(root.permanent.rootAutomationUnlocked).toBe(true);
    expect(root.automation).toEqual(before.automation);
    expect(root.permanent.deepResearchUnlocked).toBe(false);
    expect(root.permanent.rootConnectionUnlocked).toBe(false); expect(root.permanent.originAnalysisUnlocked).toBe(false);
    expect(root.permanent.lifetimePrestigeCount).toBe(before.permanent.lifetimePrestigeCount);
    expect(root.permanent.lifetimePrestigePointsEarned).toBe(before.permanent.lifetimePrestigePointsEarned);
    expect(root.permanent.pointsLostByRoot).toBe(before.permanent.unspentPoints + 4);
    expect(root.permanent.depthMeters).toBe(before.permanent.depthMeters);
    expect(getProductionPerSecond(root)).toBeAmount(3);
    expect(performRootRebirth(root)).toBe(root);
    let next = root;
    for (let count = 2; count <= 4; count += 1) {
      next = performRootRebirth(revisit(next));
      expect(next.permanent.rootRebirthCount).toBe(count);
      expect(next.permanent.deepResearchCount).toBe(count);
      expect(next.permanent.unspentRootCrystals).toBe(count);
      expect(next.permanent.prestigeCount).toBe(0);
      expect(next.permanent.lifetimePrestigeCount).toBe(before.permanent.lifetimePrestigeCount + 5 * (count - 1));
      expect(next.permanent.unspentPoints).toBe(0);
      expect(next.permanent.depthMeters).toBeGreaterThanOrEqual(before.permanent.depthMeters);
      expect(next.postDeepResearchSkillLock).toBe(false);
      expect(getProductionPerSecond(next)).toBeAmount(1 + 2 * count);
    }
  });

  it('preserves v16 ROOT assets on migration and resets them only on the next explicit ROOT', () => {
    const migrated = createLegacyRootState();
    expect(migrated.permanent.legacyRootProgress).toBe(true);
    expect(migrated.permanent.rootAutomationUnlocked).toBe(true);
    expect(migrated.permanent.prestigeCount).toBe(6);
    expect(migrated.permanent.lifetimePrestigeCount).toBe(6);
    expect(migrated.permanent.unspentPoints).toBe(1);
    expect(migrated.permanent.pointsLostByRoot).toBe(0);
    expect(migrated.permanent.skillRanks.breakthrough).toBe(1);
    expect(migrated.permanent.deepResearchUnlocked).toBe(true);
    expect(parseSave(serializeSave(createSave(migrated, 123))).gameState).toEqual(migrated);
    const next = performRootRebirth(revisit(migrated));
    expect(next.permanent.legacyRootProgress).toBe(false);
    expect(next.permanent.prestigeCount).toBe(0);
    expect(next.permanent.skillRanks).toEqual(createInitialState().permanent.skillRanks);
    expect(next.permanent.pointsLostByRoot).toBeGreaterThan(0);
    expect(() => createSave({ ...next, permanent: { ...next.permanent, deepResearchUnlocked: true } }, 0)).toThrow();
    expect(() => createSave({ ...next, permanent: { ...next.permanent, rootAutomationUnlocked: false } }, 0)).toThrow();
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
    const late = performDeepResearch(createNextRootAnalysisReadyState(adapted));
    expect(getEquipmentPurchaseGain('veinExtractor', late)).toBeAmount(gn(500000).multiply(2.5 * 5 * 1.5 * 1.5));
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
    const ready = withLegacyRefunds(createRootRebirthReadyState());
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
