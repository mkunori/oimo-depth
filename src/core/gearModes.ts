import { GEAR_IDS } from '../data/gear';
import type { GearId } from '../data/gear';
import type { GearModeId, GearPresetId } from '../data/gearModes';
import type { GameState, PermanentProgress } from './state';
import { assertGearSettings, getModeDefinition, presetModes, reconcileGearPreset } from './gearModeEffects';
import { getProductionPerSecond } from './game';
import { getDigSpeed, getEffectiveHardness } from './excavation';
import { getScoreCap } from '../data/scoreCaps';

function update(state: GameState, permanent: PermanentProgress): GameState {
  assertGearSettings(permanent);
  return { ...state, permanent };
}
export function setGearMode(state: GameState, id: GearId, mode: GearModeId): GameState {
  getProductionPerSecond(state);
  if (!GEAR_IDS.includes(id)) throw new RangeError('Unknown gear.');
  getModeDefinition(id, mode);
  if (!state.permanent.gearUnlocked[id] || state.permanent.gearModes[id] === mode) return state;
  return update(state, reconcileGearPreset({ ...state.permanent, gearModes: { ...state.permanent.gearModes, [id]: mode } }));
}
export function applyGearPreset(state: GameState, id: GearPresetId): GameState {
  getProductionPerSecond(state);
  const modes = presetModes(state.permanent, id);
  if (!modes || !GEAR_IDS.some((gear) => state.permanent.gearUnlocked[gear])) return state;
  const gearModes = { ...state.permanent.gearModes };
  for (const gear of GEAR_IDS) if (state.permanent.gearUnlocked[gear]) gearModes[gear] = modes[gear] ?? 'standard';
  return update(state, { ...state.permanent, gearModes, selectedGearPreset: id });
}
export function editGearPreset(state: GameState, slot: number, operation: 'save' | 'rename' | 'delete', name = ''): GameState {
  getProductionPerSecond(state);
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) throw new RangeError('Unknown custom slot.');
  const p = state.permanent, slots = [...p.gearCustomPresets], previous = slots[slot];
  const id = `custom-${slot + 1}` as GearPresetId;
  if (operation === 'delete') slots[slot] = null;
  else if (operation === 'rename') {
    if (!previous) return state;
    slots[slot] = { ...previous, name: name.trim() };
  } else if (operation === 'save') {
    const modes = Object.fromEntries(GEAR_IDS.filter((gear) => p.gearUnlocked[gear]).map((gear) => [gear, p.gearModes[gear]]));
    slots[slot] = { name: name.trim(), modes };
  } else throw new RangeError('Unknown preset operation.');
  return update(state, { ...p, gearCustomPresets: slots,
    selectedGearPreset: operation === 'save' ? id : operation === 'delete' && p.selectedGearPreset === id ? 'custom' : p.selectedGearPreset });
}
export function getGearRates(state: GameState) {
  const capacity = getProductionPerSecond(state), stopped = state.runEarnedScore.gte(getScoreCap(state));
  return { production: stopped ? capacity.multiply(0) : capacity, dig: stopped ? 0 : getDigSpeed(state), hardness: getEffectiveHardness(state.permanent) };
}
export function previewGearChange(state: GameState, action: (state: GameState) => GameState) {
  return { before: getGearRates(state), after: getGearRates(action(state)) };
}
