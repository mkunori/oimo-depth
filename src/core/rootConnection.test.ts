import { withLegacyRefunds } from '../test/progress';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRootConnectionReadyState, createResearchReadyState } from '../test/progress';
import { getRootConnection, performRootConnection } from './rootConnection';
import { advanceGame, advanceWithAutomation, configureAutomation, getEquipmentPurchaseGain, getProductionPerSecond, getPurchaseQuote, getRootLink, purchaseEquipment } from './game';
import { prestigeGame } from './prestige';
import { performBreakthrough } from './breakthrough';
import { performDeepResearch, purchaseResearch, resetResearch } from './research';
import { createInitialState } from './state';
import { createSave, parseSave, serializeSave, settleOffline, SAVE_VERSION } from './save';
import { gn, approximatelyEqual } from './numbers';
import { stringifyTestSave } from '../test/amounts';
import { EQUIPMENT_IDS } from '../data/equipment';
import type { GameState } from './state';

function linkedState(): GameState {
  const state = performRootConnection(createRootConnectionReadyState(true));
  return { ...state, imo: gn(8e14), runEarnedScore: gn(9e14), researchRanks: { geology: 2, resonance: 3 },
    equipmentCounts: { ...state.equipmentCounts, rootRelay: 1, coreChamber: 1 } };
}

describe('root connection and equipment links', () => {
  it('requires the stage2 cap and changes only permission/discovery/cap, with a free repeat after prestige', () => {
    for (const state of [createInitialState(), createResearchReadyState(), performDeepResearch(createResearchReadyState())]) {
      expect(getRootConnection(state).canConnect).toBe(false); expect(performRootConnection(state)).toBe(state);
      expect(purchaseEquipment(state, 'rootRelay', 'MAX')).toBe(state);
    }
    const before = createRootConnectionReadyState();
    const after = performRootConnection(before);
    expect(after).toEqual({ ...before, scoreCapStage: 3, permanent: { ...before.permanent, rootCycleMaxUnlockedStage: 3, rootConnectionUnlocked: true, maxDiscoveredStage: 3 } });
    expect(performRootConnection(after)).toBe(after);
    expect(after.postDeepResearchSkillLock).toBe(true);
    expect(performDeepResearch(after)).toBe(after);
    const next = prestigeGame(after);
    expect(next.permanent.rootConnectionUnlocked).toBe(true); expect(next.permanent.maxDiscoveredStage).toBe(3);
    expect(next.scoreCapStage).toBe(2); expect(next.postDeepResearchSkillLock).toBe(false);
    const repeated = performRootConnection(advanceGame(performDeepResearch(advanceGame(performBreakthrough(advanceGame(next, 1e6)), 1e9)), Number.MAX_VALUE));
    expect(repeated.scoreCapStage).toBe(3); expect(repeated.permanent.deepResearchCount).toBe(1);
    expect(repeated.permanent.unspentPoints).toBe(next.permanent.unspentPoints);
  });

  it('derives link boundaries and total marginal gain, excludes resonance and gives MAX the same result as single purchases', () => {
    const state = linkedState();
    for (const [rootRelay, coreChamber, linked] of [[1, 1, 0], [2, 0, 0], [2, 1, 1], [3, 2, 1], [4, 2, 2]]) {
      const counts = { ...state.equipmentCounts, rootRelay: rootRelay!, coreChamber: coreChamber! };
      expect(getRootLink(counts).linked).toBe(linked);
      expect(getProductionPerSecond({ ...state, equipmentCounts: counts })).toBeAmount(gn(1).add(gn(5e8).multiply(rootRelay!)).add(gn(5e9).multiply(coreChamber!)).add(gn(5e9).multiply(linked!)).multiply(4));
    }
    const afterRelay = purchaseEquipment(state, 'rootRelay', 1);
    expect(getEquipmentPurchaseGain('rootRelay', state)).toBeAmount(22e9);
    expect(getProductionPerSecond(afterRelay).subtract(getProductionPerSecond(state))).toBeAmount(getEquipmentPurchaseGain('rootRelay', state));
    const readyChamber = { ...state, equipmentCounts: { ...state.equipmentCounts, rootRelay: 2, coreChamber: 0 } };
    expect(getEquipmentPurchaseGain('coreChamber', readyChamber)).toBeAmount(40e9);
    const quote = getPurchaseQuote(state, 'rootRelay', 'MAX');
    let single = state;
    for (let i = 0; i < quote.quantity; i += 1) single = purchaseEquipment(single, 'rootRelay', 1);
    expect(purchaseEquipment(state, 'rootRelay', 'MAX')).toEqual(single);
    expect(state.imo.subtract(single.imo)).toBeAmount(quote.totalCost);
    expect(purchaseResearch(state, 'geology').researchRanks.geology).toBe(3);
    expect(resetResearch(state).researchRanks).toEqual({ geology: 0, resonance: 0 });
  });

  it('uses the link gain in automation, supports all policies and preserves offline/split settlement at the 1e15 stop', () => {
    const base = linkedState();
    for (const policy of ['efficient', 'balanced', 'priority'] as const) {
      const state = configureAutomation(base, { ...base.automation, enabled: true, policy,
        equipment: Object.fromEntries(EQUIPMENT_IDS.map((id) => [id, id === 'rootRelay' || id === 'coreChamber'])) as GameState['automation']['equipment'] });
      const whole = advanceWithAutomation(state, 86400, true);
      if (policy === 'efficient') expect(whole.events[0]?.id).toBe('rootRelay');
      expect(whole.state.runEarnedScore).toBeAmount(1e15);
      expect(whole.purchaseCount).toBeLessThan(1024);
      expect(settleOffline(createSave(state, 0), 48 * 3600_000).save.gameState).toEqual(whole.state);
      let split = advanceGame(state, 3600);
      split = parseSave(serializeSave(createSave(split, 0))).gameState;
      split = advanceGame(split, 86400 - 3600);
      expect(split.equipmentCounts).toEqual(whole.state.equipmentCounts);
      expect(approximatelyEqual(split.imo, whole.state.imo, 1, 1e-12)).toBe(true);
      expect(advanceGame(whole.state, 1)).toBe(whole.state);
      expect(purchaseEquipment(whole.state, 'coreChamber', 'MAX')).toBe(whole.state);
      expect(purchaseResearch(whole.state, 'geology')).toBe(whole.state);
      expect(resetResearch(whole.state)).toBe(whole.state);
    }
  });

  it('preserves v8 history/settings/assets, infers only proven discoveries, round trips v9 and rejects forged stage3/ownership', () => {
    const current = withLegacyRefunds(createRootConnectionReadyState(true));
    const old = JSON.parse(serializeSave(createSave(current, 1234)));
    old.saveVersion = 8; delete old.gameState.permanent.rootConnectionUnlocked; delete old.gameState.permanent.maxDiscoveredStage;
    for (const id of ['rootRelay', 'coreChamber', 'originMiner', 'imoReactor']) { delete old.gameState.equipmentCounts[id]; delete old.gameState.automation.equipment[id]; }
    old.gameState.automation.equipment.cart = false;
    old.gameState.automation.priority = old.gameState.automation.priority.filter((id: string) => !['rootRelay', 'coreChamber', 'originMiner', 'imoReactor'].includes(id)).reverse();
    const migrated = parseSave(JSON.stringify(old));
    expect(migrated.saveVersion).toBe(SAVE_VERSION); expect(migrated.savedAt).toBe(1234);
    expect(migrated.gameState).toEqual({ ...current, permanent: { ...current.permanent, depthMeters: 0, depthRemainder: 0 }, automation: { ...current.automation, equipment: { ...current.automation.equipment, cart: false }, priority: [...old.gameState.automation.priority, 'rootRelay', 'coreChamber', 'originMiner', 'imoReactor'] } });
    const stage3 = performRootConnection(migrated.gameState);
    expect(parseSave(serializeSave(createSave(stage3, 0))).gameState).toEqual(stage3);
    const legacy = JSON.parse(readFileSync(new URL('../test/fixtures/save-v6.json', import.meta.url), 'utf8'));
    legacy.gameState.scoreCapStage = 0; legacy.gameState.runEarnedScore = 0; legacy.gameState.imo = 0;
    legacy.gameState.equipmentCounts = Object.fromEntries(Object.keys(legacy.gameState.equipmentCounts).map((id) => [id, 0]));
    expect(parseSave(JSON.stringify(legacy)).gameState.permanent.maxDiscoveredStage).toBe(2);
    const permissionOnly = { ...createResearchReadyState(), scoreCapStage: 0 as const, runEarnedScore: gn(0), imo: gn(0), permanent: { ...createResearchReadyState().permanent, maxDiscoveredStage: 0 as const } };
    expect(parseSave(stringifyTestSave({ saveVersion: 8, savedAt: 0, gameState: permissionOnly })).gameState.permanent.maxDiscoveredStage).toBe(0);
    for (const change of [
      { permanent: { ...stage3.permanent, rootConnectionUnlocked: false } }, { permanent: { ...stage3.permanent, maxDiscoveredStage: 2 } },
      { runEarnedScore: gn(1e15 + 1) }, { runEarnedScore: gn(1e12 - 1), imo: gn(0) },
      { scoreCapStage: 2 }, { equipmentCounts: { ...stage3.equipmentCounts, rootRelay: 0.5 } },
    ]) {
      const invalid = { ...stage3, ...change, ...(change.scoreCapStage === 2 ? { equipmentCounts: { ...stage3.equipmentCounts, rootRelay: 1 } } : {}) } as GameState;
      expect(() => createSave(invalid, 0)).toThrow();
    }
  });
});
