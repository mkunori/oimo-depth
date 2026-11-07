import { EQUIPMENT_IDS } from '../data/equipment';
import { GEAR_IDS } from '../data/gear';
import type { GearId } from '../data/gear';
import { EQUIPMENT_GROUPS, GEAR_MODES, GEAR_PRESETS } from '../data/gearModes';
import type { GearModeDefinition, GearModes, GearPresetId } from '../data/gearModes';
import type { PermanentProgress } from './state';

export function getModeDefinition(id: GearId, mode: string): GearModeDefinition {
  if (!Object.hasOwn(GEAR_MODES[id], mode)) throw new RangeError('Unknown gear mode.');
  return (GEAR_MODES[id] as Record<string, GearModeDefinition>)[mode]!;
}
export function presetModes(p: PermanentProgress, id: GearPresetId): Partial<GearModes> | null {
  if (Object.hasOwn(GEAR_PRESETS, id)) return GEAR_PRESETS[id as keyof typeof GEAR_PRESETS].modes;
  if (/^custom-[123]$/.test(id)) return p.gearCustomPresets[Number(id.slice(-1)) - 1]?.modes ?? null;
  return null;
}
export function matchesPreset(p: PermanentProgress): boolean {
  if (p.selectedGearPreset === 'custom') return true;
  const modes = presetModes(p, p.selectedGearPreset);
  return modes !== null && GEAR_IDS.every((id) => !p.gearUnlocked[id] || p.gearModes[id] === (modes[id] ?? 'standard'));
}
export function reconcileGearPreset(p: PermanentProgress): PermanentProgress {
  return matchesPreset(p) ? p : { ...p, selectedGearPreset: 'custom' };
}
const validated = new WeakSet<object>();
export function assertGearSettings(p: PermanentProgress): void {
  if (validated.has(p)) return;
  if (!p.gearModes || Object.keys(p.gearModes).length !== GEAR_IDS.length || !Array.isArray(p.gearCustomPresets)
    || p.gearCustomPresets.length !== 3 || typeof p.selectedGearPreset !== 'string'
    || !(p.selectedGearPreset === 'custom' || Object.hasOwn(GEAR_PRESETS, p.selectedGearPreset) || /^custom-[123]$/.test(p.selectedGearPreset))) throw new RangeError('Invalid gear settings.');
  for (const id of GEAR_IDS) {
    getModeDefinition(id, p.gearModes[id]);
    if (!p.gearUnlocked[id] && p.gearModes[id] !== 'standard') throw new RangeError('Unowned gear mode.');
  }
  const names = new Set(Object.values(GEAR_PRESETS).map((v) => v.name as string));
  for (const slot of p.gearCustomPresets) {
    if (slot === null) continue;
    if (!slot || typeof slot.name !== 'string' || slot.name !== slot.name.trim() || !slot.name || slot.name.length > 20
      || /[\x00-\x1f\x7f]/.test(slot.name) || names.has(slot.name) || !slot.modes || !Object.keys(slot.modes).length) throw new RangeError('Invalid custom preset.');
    names.add(slot.name);
    for (const [id, mode] of Object.entries(slot.modes)) {
      if (!GEAR_IDS.includes(id as GearId) || !p.gearUnlocked[id as GearId] || typeof mode !== 'string') throw new RangeError('Unknown preset gear.');
      getModeDefinition(id as GearId, mode);
    }
  }
  if (!matchesPreset(p)) throw new RangeError('Preset does not match modes.');
  validated.add(p);
}
const effectsCache = new Map<string, { global: number; link: number; dig: number; hardness: number; equipment: Record<typeof EQUIPMENT_IDS[number], number> }>();
export function getGearModeEffects(p: PermanentProgress, geology = 0) {
  const key = `${gearModeKey(p)}:${geology > 0}`;
  const cached = effectsCache.get(key);
  if (cached) return cached;
  const equipment = Object.fromEntries(EQUIPMENT_IDS.map((id) => [id, 1])) as Record<typeof EQUIPMENT_IDS[number], number>;
  let global = 1, link = 1, dig = 1, hardness = 1;
  for (const id of GEAR_IDS) {
    if (!p.gearUnlocked[id]) continue;
    const m = getModeDefinition(id, p.gearModes[id]);
    if (m.needsGeology && geology === 0) continue;
    global *= m.global ?? 1; link *= m.link ?? 1; dig *= m.dig ?? 1; hardness *= m.hardness ?? 1;
    if (m.group) for (const equipmentId of EQUIPMENT_GROUPS[m.group]) equipment[equipmentId] *= m.equipment ?? 1;
  }
  const result = Object.freeze({ global, link, dig, hardness, equipment: Object.freeze(equipment) });
  if (effectsCache.size < 4096) effectsCache.set(key, result);
  return result;
}
export function gearModeKey(p: PermanentProgress) { return p.rootRebirthCount === 0 ? '-' : GEAR_IDS.map((id) => p.gearUnlocked[id] ? p.gearModes[id] : '-').join(','); }
