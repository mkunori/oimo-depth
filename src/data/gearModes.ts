import { EQUIPMENT_IDS } from './equipment';
import type { EquipmentId } from './equipment';
import type { GearId } from './gear';

export const EQUIPMENT_GROUPS = {
  early: ['worker', 'cart', 'harvester'],
  initial: ['worker', 'cart', 'harvester', 'deepDrill', 'refinery'],
  deep: ['veinExtractor', 'concentrator', 'rootRelay', 'coreChamber', 'originMiner', 'imoReactor'],
  drilling: ['deepDrill', 'veinExtractor', 'rootRelay', 'originMiner'],
  refining: ['refinery', 'concentrator', 'coreChamber', 'imoReactor'],
  root: ['rootRelay', 'coreChamber'],
  all: EQUIPMENT_IDS,
} as const satisfies Record<string, readonly EquipmentId[]>;
export interface GearModeDefinition {
  readonly name: string; readonly description: string; readonly source: 'gear-mode';
  readonly global?: number; readonly group?: keyof typeof EQUIPMENT_GROUPS; readonly equipment?: number;
  readonly link?: number; readonly dig?: number; readonly hardness?: number; readonly needsGeology?: boolean;
}
const standard = { name: '標準', description: '追加効果なし。常時効果は有効です。', source: 'gear-mode' } as const;
export const GEAR_MODES = {
  shovel: { standard,
    balanced: { name: '均衡', description: '全生産 ×1.12', source: 'gear-mode', global: 1.12 },
    rush: { name: '初動', description: '初期3設備の生産 ×1.6', source: 'gear-mode', group: 'early', equipment: 1.6 },
    excavation: { name: '掘削', description: '掘削力 ×1.8', source: 'gear-mode', dig: 1.8 } },
  lens: { standard,
    broad: { name: '広域', description: '全設備の生産 ×1.12（基礎・リンク追加生産を除く）', source: 'gear-mode', group: 'all', equipment: 1.12 },
    deep: { name: '深層', description: '深層以降の6設備の生産 ×1.45', source: 'gear-mode', group: 'deep', equipment: 1.45 } },
  drillBit: { standard,
    drills: { name: '採掘', description: '採掘系4設備の生産 ×1.55', source: 'gear-mode', group: 'drilling', equipment: 1.55 },
    refining: { name: '精製', description: '精製系4設備の生産 ×1.55', source: 'gear-mode', group: 'refining', equipment: 1.55 },
    fracture: { name: '破砕', description: '掘削力 ×2', source: 'gear-mode', dig: 2 } },
  compass: { standard,
    balanced: { name: '均衡', description: '全生産 ×1.1', source: 'gear-mode', global: 1.1 },
    resonance: { name: '研究共鳴', description: '地質研究1以上で全生産 ×1.25', source: 'gear-mode', global: 1.25, needsGeology: true },
    link: { name: '連携', description: 'リンク追加生産 ×2', source: 'gear-mode', link: 2 },
    geology: { name: '地質', description: '実効硬度 ×0.75', source: 'gear-mode', hardness: 0.75 } },
  rootCore: { standard,
    rushing: { name: '周回', description: '初期5設備の生産 ×2.5', source: 'gear-mode', group: 'initial', equipment: 2.5 },
    global: { name: '全域', description: '全生産 ×1.4', source: 'gear-mode', global: 1.4 },
    rootFocus: { name: '根脈集中', description: '根脈2設備とリンク追加生産をそれぞれ ×2.2', source: 'gear-mode', group: 'root', equipment: 2.2, link: 2.2 },
    exploration: { name: '探索', description: '掘削力 ×3', source: 'gear-mode', dig: 3 } },
} as const satisfies Record<GearId, Record<string, GearModeDefinition>>;
export type GearModeId = { [K in GearId]: keyof typeof GEAR_MODES[K] }[GearId];
export type GearModes = Readonly<Record<GearId, GearModeId>>;
export const createStandardModes = (): GearModes => ({ shovel: 'standard', lens: 'standard', drillBit: 'standard', compass: 'standard', rootCore: 'standard' });
export const GEAR_PRESETS = {
  standard: { name: '標準', modes: createStandardModes() },
  speed: { name: '高速周回', modes: { shovel: 'rush', lens: 'broad', drillBit: 'drills', compass: 'balanced', rootCore: 'rushing' } },
  growth: { name: '長期成長', modes: { shovel: 'balanced', lens: 'deep', drillBit: 'refining', compass: 'resonance', rootCore: 'global' } },
  links: { name: '根脈連携', modes: { shovel: 'balanced', lens: 'deep', drillBit: 'refining', compass: 'link', rootCore: 'rootFocus' } },
  depth: { name: 'DEPTH探索', modes: { shovel: 'excavation', lens: 'broad', drillBit: 'fracture', compass: 'geology', rootCore: 'exploration' } },
} as const satisfies Record<string, { name: string; modes: GearModes }>;
export type BuiltinGearPreset = keyof typeof GEAR_PRESETS;
export type GearPresetId = BuiltinGearPreset | 'custom-1' | 'custom-2' | 'custom-3' | 'custom';
export interface CustomGearPreset { readonly name: string; readonly modes: Partial<GearModes> }
export const createGearSettings = () => ({ gearModes: createStandardModes(), gearCustomPresets: [null, null, null] as readonly (CustomGearPreset | null)[], selectedGearPreset: 'standard' as GearPresetId });
