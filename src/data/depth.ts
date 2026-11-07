import { gn } from '../core/numbers';

export const DEPTH_BALANCE = Object.freeze({ baseDigPower: 0.025, maxMeters: 1e12, linkBonusPerPair: 0.1 });
export const STRATA = [
  { start: 0, name: '表層土', hardness: 1 },
  { start: 10, name: '粘土層', hardness: 3 },
  { start: 100, name: '岩盤層', hardness: 12 },
  { start: 1000, name: '地脈層', hardness: 60 },
  { start: 10000, name: '根脈層', hardness: 500 },
  { start: 100000, name: '根源領域', hardness: 5000 },
] as const;
export const DEPTH_REWARDS = [
  { depth: 10, name: '地層図鑑', description: '到達した地層の記録を閲覧できます。' },
  { depth: 100, name: '基本掘削研究', description: '任意の恒久掘削強化を購入できます。' },
  { depth: 1000, name: '地脈掘削研究', description: 'さらに掘削力を強化できます。芋生産の地層収穫学とは別の研究です。' },
  { depth: 10000, name: '連携掘削補助', description: '設備連携1組につき掘削倍率+10%。連携設備がなければ変化しません。' },
  { depth: 100000, name: '根源領域記録', description: '深部到達の恒久記録。転生・突破の追加条件にはなりません。' },
] as const;
export const DIG_RESEARCH_IDS = ['basic', 'vein'] as const;
export type DigResearchId = typeof DIG_RESEARCH_IDS[number];
export type DigResearchRanks = Readonly<Record<DigResearchId, number>>;
export const DIG_RESEARCH = {
  basic: { name: '基本掘削研究', unlockDepth: 100, costs: [gn(1e4), gn(1e5), gn(1e6)] },
  vein: { name: '地脈掘削研究', unlockDepth: 1000, costs: [gn(1e7), gn(1e8), gn(1e9)] },
} as const;
export function createEmptyDigResearch(): DigResearchRanks { return { basic: 0, vein: 0 }; }
