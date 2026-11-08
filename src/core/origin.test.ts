import { withLegacyRefunds } from '../test/progress';
import { describe, expect, it } from 'vitest';
import { createRootConnectionReadyState } from '../test/progress';
import { performRootConnection } from './rootConnection';
import { getOriginAnalysis, performOriginAnalysis } from './origin';
import { advanceGame, advanceWithAutomation, configureAutomation, getEquipmentPurchaseGain, getProductionPerSecond, getPurchaseQuote, isEquipmentDiscovered, purchaseEquipment } from './game';
import { purchaseOriginResearch, resetResearch } from './research';
import { performBreakthrough } from './breakthrough';
import { performDeepResearch } from './research';
import { prestigeGame } from './prestige';
import { createSave, parseSave, serializeSave, settleOffline } from './save';
import { gn, approximatelyEqual } from './numbers';
import { EQUIPMENT_IDS } from '../data/equipment';
import { createInitialState } from './state';
import { getOriginResearchSpent } from '../data/originResearch';
import { getResearchSpent } from '../data/research';

export function originReady() {
  return advanceGame(performRootConnection(createRootConnectionReadyState(true)), Number.MAX_VALUE);
}

describe('origin analysis', () => {
  it('requires only the stage3 cap, preserves all assets and discovery through prestige and a free repeat', () => {
    const initial = createInitialState();
    const before = { ...originReady(), permanent: { ...originReady().permanent, depthMeters: 0, depthRemainder: 0 } };
    for (const state of [initial, performRootConnection(createRootConnectionReadyState())]) {
      expect(getOriginAnalysis(state).canAnalyze).toBe(false);
      expect(performOriginAnalysis(state)).toBe(state);
      expect(purchaseEquipment(state, 'originMiner', 'MAX')).toBe(state);
      expect(purchaseOriginResearch(state, 'harvest')).toBe(state);
      expect(isEquipmentDiscovered('imoReactor', state)).toBe(false);
    }
    const after = performOriginAnalysis(before);
    expect(after).toEqual({ ...before, scoreCapStage: 4, permanent: { ...before.permanent, rootCycleMaxUnlockedStage: 4, originAnalysisUnlocked: true, maxDiscoveredStage: 4 } });
    expect(performOriginAnalysis(after)).toBe(after);
    expect(advanceGame(after, 60).permanent.depthMeters).toBeGreaterThan(0);
    const next = prestigeGame(after);
    expect(next.scoreCapStage).toBe(2); expect(next.originResearchRanks).toEqual({ harvest: 0, link: 0 });
    expect(next.runEarnedScore).toBeAmount(0); expect(next.imo).toBeAmount(0);
    expect(next.researchRanks).toEqual({ geology: 0, resonance: 0 });
    expect(next.equipmentCounts).toEqual(createInitialState().equipmentCounts);
    expect(next.postDeepResearchSkillLock).toBe(false);
    expect(next.permanent.deepResearchCount).toBe(after.permanent.deepResearchCount);
    expect(performRootConnection(next)).toBe(next); expect(performOriginAnalysis(next)).toBe(next);
    expect(purchaseEquipment(next, 'rootRelay', 1)).toBe(next);
    expect(purchaseEquipment(next, 'originMiner', 1)).toBe(next);
    expect(() => createSave({ ...next, scoreCapStage: 3 }, 0)).toThrow();
    expect(() => createSave({ ...next, equipmentCounts: { ...next.equipmentCounts, rootRelay: 1 } }, 0)).toThrow();
    expect(next.permanent.originAnalysisUnlocked).toBe(true); expect(isEquipmentDiscovered('imoReactor', next)).toBe(true);
    const repeated = performOriginAnalysis(advanceGame(performRootConnection(advanceGame(performDeepResearch(advanceGame(performBreakthrough(advanceGame(next, 1e6)), 1e9)), Number.MAX_VALUE)), Number.MAX_VALUE));
    expect(repeated.scoreCapStage).toBe(4); expect(repeated.permanent.maxDiscoveredStage).toBe(4);
    expect(repeated.permanent.unspentPoints).toBe(next.permanent.unspentPoints);
  });

  it('prices in huge numbers, applies global/link research to marginal gain, and refunds only imo', () => {
    const base = performOriginAnalysis(originReady());
    const funded = { ...base, imo: gn(8e17), runEarnedScore: gn(9e17), researchRanks: { geology: 3, resonance: 3 },
      equipmentCounts: { ...base.equipmentCounts, rootRelay: 1, coreChamber: 1 } };
    const studied = purchaseOriginResearch(purchaseOriginResearch(funded, 'harvest'), 'link');
    const rate = getProductionPerSecond(studied);
    expect(studied.runEarnedScore).toBeAmount(funded.runEarnedScore);
    expect(getEquipmentPurchaseGain('rootRelay', studied)).toBeAmount(gn(5e8).add(1e10).multiply(8 * 1.5));
    expect(getProductionPerSecond(purchaseEquipment(studied, 'rootRelay', 1)).subtract(rate)).toBeAmount(getEquipmentPurchaseGain('rootRelay', studied));
    const quote = getPurchaseQuote(studied, 'imoReactor', 'MAX');
    let single = studied;
    for (let i = 0; i < quote.quantity; i += 1) single = purchaseEquipment(single, 'imoReactor', 1);
    const bulk = purchaseEquipment(studied, 'imoReactor', 'MAX');
    expect(bulk.equipmentCounts).toEqual(single.equipmentCounts);
    expect(bulk.imo).toBeAmount(studied.imo.subtract(quote.totalCost));
    expect(approximatelyEqual(bulk.imo, single.imo, 1, 1e-12)).toBe(true);
    expect(single.imo.gte(0)).toBe(true); expect(quote.totalCost.gt(Number.MAX_SAFE_INTEGER)).toBe(true);
    const reset = resetResearch(studied);
    expect(reset.originResearchRanks).toEqual({ harvest: 0, link: 0 });
    expect(reset.imo).toBeAmount(studied.imo.add(getOriginResearchSpent(studied.originResearchRanks).add(getResearchSpent(studied.researchRanks))));
    expect(reset.runEarnedScore).toBeAmount(studied.runEarnedScore);
  });

  it('uses all automation policies at stage4 and stops production, purchases and depth at 1e18, including offline', () => {
    const base = performOriginAnalysis(originReady());
    const funded = { ...base, imo: gn(8e17), runEarnedScore: gn(9e17), equipmentCounts: { ...base.equipmentCounts, imoReactor: 500 } };
    for (const policy of ['efficient', 'balanced', 'priority'] as const) {
      const state = configureAutomation(funded, { ...funded.automation, enabled: true, policy,
        equipment: Object.fromEntries(EQUIPMENT_IDS.map((id) => [id, id === 'originMiner' || id === 'imoReactor'])) as typeof funded.automation.equipment });
      const whole = advanceWithAutomation(state, 86400, true);
      expect(whole.purchaseCount).toBeGreaterThan(0); expect(whole.purchaseCount).toBeLessThan(2048);
      expect(whole.state.runEarnedScore).toBeAmount(1e18);
      const offline = settleOffline(createSave(state, 0), 48 * 3600_000);
      expect(offline.save.gameState).toEqual(whole.state);
      const split = advanceGame(parseSave(serializeSave(createSave(advanceGame(state, 3600), 0))).gameState, 82800);
      expect(split.equipmentCounts).toEqual(whole.state.equipmentCounts);
      expect(approximatelyEqual(split.imo, whole.state.imo, 1, 1e-12)).toBe(true);
      expect(advanceGame(whole.state, 1e9)).toBe(whole.state);
      expect(purchaseEquipment(whole.state, 'originMiner', 'MAX')).toBe(whole.state);
      expect(purchaseOriginResearch(whole.state, 'harvest')).toBe(whole.state);
      expect(resetResearch(whole.state)).toBe(whole.state);
      expect(prestigeGame(whole.state).scoreCapStage).toBe(2);
    }
  });

  it('preserves v10 depth/history/assets/settings, adds undiscovered defaults and rejects forged stage4 progress', () => {
    const base = withLegacyRefunds(originReady());
    const old = JSON.parse(serializeSave(createSave(base, 1234)));
    old.saveVersion = 10; delete old.gameState.originResearchRanks; delete old.gameState.permanent.originAnalysisUnlocked;
    for (const id of ['originMiner', 'imoReactor']) { delete old.gameState.equipmentCounts[id]; delete old.gameState.automation.equipment[id]; }
    old.gameState.automation.equipment.cart = false;
    old.gameState.automation.priority = old.gameState.automation.priority.filter((id: string) => !['originMiner', 'imoReactor'].includes(id)).reverse();
    const migrated = parseSave(JSON.stringify(old));
    expect(migrated.savedAt).toBe(1234);
    expect(migrated.gameState).toEqual({ ...base, automation: { ...base.automation, equipment: { ...base.automation.equipment, cart: false }, priority: [...old.gameState.automation.priority, 'originMiner', 'imoReactor'] } });
    const after = performOriginAnalysis(migrated.gameState);
    expect(parseSave(serializeSave(createSave(after, 0))).gameState).toEqual(after);
    for (const change of [
      { permanent: { ...after.permanent, originAnalysisUnlocked: false } },
      { permanent: { ...after.permanent, maxDiscoveredStage: 3 as const } },
      { runEarnedScore: gn(1e18).add(1e6) }, { runEarnedScore: gn(1e15 - 1), imo: gn(0) },
      { originResearchRanks: { harvest: 4, link: 0 } },
    ]) expect(() => createSave({ ...after, ...change }, 0)).toThrow();
    expect(() => createSave({ ...base, originResearchRanks: { harvest: 1, link: 0 } }, 0)).toThrow();
    expect(() => createSave({ ...base, equipmentCounts: { ...base.equipmentCounts, originMiner: 1 } }, 0)).toThrow();
  });
});
