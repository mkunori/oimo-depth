import { gn } from '../core/numbers';
import type { ScoreCapStage } from './scoreCaps';

export const GEAR = {
  shovel: { name: '強化スコップ', minimumRootCount: 1, discoveryStage: 0, price: gn(1e5), source: 'gear', passive: { productionMultiplier: 1.05 } },
  lens: { name: '自動選別レンズ', minimumRootCount: 1, discoveryStage: 1, price: gn(1e8), source: 'gear', passive: { productionMultiplier: 1.05 } },
  drillBit: { name: '古代ドリルビット', minimumRootCount: 1, discoveryStage: 2, price: gn(1e11), source: 'gear', passive: { productionMultiplier: 1.05 } },
  compass: { name: '地脈コンパス', minimumRootCount: 2, discoveryStage: 3, price: gn(1e14), source: 'gear', passive: { productionMultiplier: 1.05 } },
  rootCore: { name: '根源コア', minimumRootCount: 3, discoveryStage: 4, price: gn(1e17), source: 'gear', passive: { productionMultiplier: 1.10 } },
} as const satisfies Record<string, { name: string; minimumRootCount: number; discoveryStage: ScoreCapStage;
  price: ReturnType<typeof gn>; source: 'gear'; passive: { productionMultiplier: number } }>;
export type GearId = keyof typeof GEAR;
export type GearFlags = Readonly<Record<GearId, boolean>>;
export const GEAR_IDS = Object.keys(GEAR) as GearId[];
export function createEmptyGear(): GearFlags { return { shovel: false, lens: false, drillBit: false, compass: false, rootCore: false }; }
