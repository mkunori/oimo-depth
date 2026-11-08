import { getSkillBonuses } from './skills';
import { withLegacyRefunds, createLegacyRootState, createNextRootAnalysisReadyState } from '../test/progress';
import { describe, expect, it } from 'vitest';
import { createRootRebirthReadyState } from '../test/progress';
import { GEAR_IDS } from '../data/gear';
import { createGearSettings } from '../data/gearModes';
import { performRootRebirth } from './root';
import { advanceGame, advanceWithAutomation, getEquipmentPurchaseGain, getProductionPerSecond } from './game';
import { unlockGear } from './gear';
import { getGearMultiplier } from './gearProgress';
import { applyGearPreset, editGearPreset, getGearRates, setGearMode } from './gearModes';
import { getDigSpeed } from './excavation';
import { performDeepResearch } from './research';
import { performRootConnection } from './rootConnection';
import { performOriginAnalysis } from './origin';
import { prestigeGame } from './prestige';
import { createSave, parseSave, serializeSave, settleOffline } from './save';
import { approximatelyEqual, gn } from './numbers';

function first() {
  const root = performRootRebirth(createRootRebirthReadyState());
  return unlockGear({ ...root, runEarnedScore: gn(1e5) }, 'shovel');
}
function late() {
  let s = first();
  s = { ...s, permanent: { ...s.permanent, rootRebirthCount: 3, deepResearchCount: 3, totalRootCrystalsEarned: 3, unspentRootCrystals: 3 } };
  s = createNextRootAnalysisReadyState(s);
  s = performDeepResearch(advanceGame(s, Number.MAX_VALUE));
  s = performRootConnection(advanceGame(s, Number.MAX_VALUE));
  s = performOriginAnalysis(advanceGame(s, Number.MAX_VALUE));
  return GEAR_IDS.reduce(unlockGear, { ...s, runEarnedScore: gn(1e18) });
}
describe('gear mode boundaries', () => {
  it('keeps every passive and applies equipment/global/link multipliers exactly once, including purchase gains', () => {
    const capped = late();
    const base = { ...capped, runEarnedScore: gn(2e17), equipmentCounts: { ...capped.equipmentCounts, rootRelay: 2, coreChamber: 1 } };
    const focused = setGearMode(base, 'rootCore', 'rootFocus');
    const passive = getGearMultiplier(base.permanent), global = getSkillBonuses(base.permanent).productionMultiplier;
    const basePart = gn(1).multiply(global).multiply(passive);
    expect(approximatelyEqual(getProductionPerSecond(focused), getProductionPerSecond(base).subtract(basePart).multiply(2.2).add(basePart), 1, 1e-12)).toBe(true);
    const linked = setGearMode(focused, 'compass', 'link');
    const expectedLinkGain = gn(5e9).multiply(global).multiply(passive * 2.2);
    expect(approximatelyEqual(getProductionPerSecond(linked).subtract(getProductionPerSecond(focused)), expectedLinkGain, 1, 1e-12)).toBe(true);
    const buyState = { ...linked, equipmentCounts: { ...linked.equipmentCounts, rootRelay: 3, coreChamber: 2 } };
    const purchased = { ...buyState, equipmentCounts: { ...buyState.equipmentCounts, rootRelay: 4 } };
    expect(approximatelyEqual(getEquipmentPurchaseGain('rootRelay', buyState), getProductionPerSecond(purchased).subtract(getProductionPerSecond(buyState)), 1, 1e-12)).toBe(true);
    expect(getGearMultiplier(linked.permanent)).toBe(passive);
    expect(linked.scoreSpentThisRun).toBeAmount(base.scoreSpentThisRun);
    expect(linked.permanent.unspentRootCrystals).toBe(base.permanent.unspentRootCrystals);
  });
  it('preserves presets across resets/serialization, starts new unlocks in standard, and supports three named snapshots', () => {
    let state = applyGearPreset(first(), 'speed');
    expect(state.permanent.gearModes.shovel).toBe('rush');
    state = editGearPreset(state, 0, 'save', 'いつもの構成');
    state = editGearPreset(state, 0, 'rename', '周回用');
    state = setGearMode(state, 'shovel', 'excavation');
    expect(state.permanent.selectedGearPreset).toBe('custom');
    state = applyGearPreset(state, 'custom-1');
    expect(state.permanent.gearModes.shovel).toBe('rush');
    expect(parseSave(serializeSave(createSave(state, 0))).gameState).toEqual(state);
    expect(prestigeGame(advanceGame(state, Number.MAX_VALUE)).permanent.gearModes).toEqual(state.permanent.gearModes);
    const speed = applyGearPreset(state, 'speed');
    const lens = unlockGear(createNextRootAnalysisReadyState(speed), 'lens');
    expect(lens.permanent.gearModes.lens).toBe('standard');
    expect(lens.permanent.selectedGearPreset).toBe('custom');
    const erased = editGearPreset(state, 0, 'delete');
    expect(erased.permanent.selectedGearPreset).toBe('custom');
    expect(erased.permanent.gearModes).toEqual(state.permanent.gearModes);
    const all = applyGearPreset(late(), 'depth'), next = performRootRebirth(all);
    expect(next.permanent.gearModes).toEqual(all.permanent.gearModes);
    expect(getGearRates(all).dig).toBe(0);
    expect(advanceWithAutomation(all, 43200).state).toEqual(all);
  });
  it('uses old modes until a switch and matches online splits with offline at identical switching times', () => {
    const initial = first(), base = { ...initial, imo: gn(1000), automation: { ...initial.automation, enabled: true } };
    const before = advanceWithAutomation(base, 60).state;
    const switched = setGearMode(before, 'shovel', 'excavation');
    expect(switched.runEarnedScore).toBeAmount(before.runEarnedScore);
    expect(switched.permanent.depthMeters).toBe(before.permanent.depthMeters);
    expect(getDigSpeed(switched)).toBeCloseTo(getDigSpeed(before) * 1.8, 12);
    const offline = settleOffline(createSave(switched, 60000), 21660000).save.gameState;
    let online = switched;
    for (let step = 0; step < 360; step++) online = advanceWithAutomation(online, 60).state;
    expect(approximatelyEqual(offline.runEarnedScore, online.runEarnedScore, 1e-6, 1e-12)).toBe(true);
    expect(online.equipmentCounts).toEqual(offline.equipmentCounts);
    expect(offline.permanent.depthMeters).toBeCloseTo(online.permanent.depthMeters, 6);
  });
  it('migrates v13 to neutral modes and rejects unknown, mismatched, unowned or malformed presets', () => {
    const legacy = createLegacyRootState();
    const state = withLegacyRefunds(unlockGear({ ...legacy, runEarnedScore: gn(1e5) }, 'shovel')), raw = JSON.parse(serializeSave(createSave(state, 0)));
    raw.saveVersion = 13;
    delete raw.gameState.permanent.gearModes; delete raw.gameState.permanent.gearCustomPresets; delete raw.gameState.permanent.selectedGearPreset;
    const migrated = parseSave(JSON.stringify(raw));
    expect(migrated.gameState.permanent.gearModes).toEqual(createGearSettings().gearModes);
    expect(getProductionPerSecond(migrated.gameState)).toBeAmount(getProductionPerSecond(state));
    for (const patch of [ { gearModes: { ...state.permanent.gearModes, shovel: 'unknown' } },
      { gearModes: { ...state.permanent.gearModes, lens: 'deep' } }, { selectedGearPreset: 'speed' }, { selectedGearPreset: 'unknown' }, { gearCustomPresets: [] },
      { gearCustomPresets: [{ name: '壊れた構成', modes: { shovel: 'deep' } }, null, null] } ]) {
      const invalid = JSON.parse(serializeSave(createSave(state, 0)));
      Object.assign(invalid.gameState.permanent, patch);
      expect(() => parseSave(JSON.stringify(invalid))).toThrow();
    }
    expect(() => setGearMode(state, 'shovel', 'deep')).toThrow();
  });
});
