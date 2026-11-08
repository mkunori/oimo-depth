import { gn } from '../core/numbers';
import type { ScoreCapStage } from './scoreCaps';
export const SKILL_IDS = ['harvest', 'discount', 'startingImo', 'breakthrough', 'automation'] as const;
export type SkillId = typeof SKILL_IDS[number];
export const ENHANCEMENT_SKILL_IDS = ['harvest', 'discount', 'startingImo'] as const;
export type EnhancementSkillId = typeof ENHANCEMENT_SKILL_IDS[number];
export function isEnhancementSkill(id: SkillId): id is EnhancementSkillId {
  return (ENHANCEMENT_SKILL_IDS as readonly SkillId[]).includes(id);
}

interface SkillDefinition {
  readonly id: SkillId;
  readonly name: string;
  readonly maxRank: number;
  readonly costs: readonly number[];
  readonly prerequisites: readonly { readonly id: SkillId; readonly rank: number }[];
  readonly minimumPrestigeCount: number;
  readonly effect: { readonly type: 'harvest' | 'discount' | 'breakthrough' | 'automation'; readonly perRank: number }
    | { readonly type: 'startingImo'; readonly values: readonly number[] };
}

/** v0 の仮バランス。前提と効果をデータとして分離し、後続の枝を追加できる。 */
export const SKILLS = {
  harvest: {
    id: 'harvest', name: '豊かな収穫', maxRank: 7, costs: [1, 2, 3, 4, 5, 6, 7], prerequisites: [],
    minimumPrestigeCount: 0, effect: { type: 'harvest', perRank: 0.5 },
  },
  discount: {
    id: 'discount', name: '設備の目利き', maxRank: 5, costs: [1, 2, 3, 4, 5],
    prerequisites: [{ id: 'harvest', rank: 1 }],
    minimumPrestigeCount: 0, effect: { type: 'discount', perRank: 10 },
  },
  startingImo: {
    id: 'startingImo', name: '旅立ちの蓄え', maxRank: 6, costs: [1, 2, 3, 4, 5, 6],
    prerequisites: [{ id: 'harvest', rank: 1 }],
    minimumPrestigeCount: 0, effect: { type: 'startingImo', values: [0, 50, 100, 500, 5000, 50000, 500000] },
  },
  breakthrough: {
    id: 'breakthrough', name: '限界突破の心得', maxRank: 1, costs: [3], minimumPrestigeCount: 5,
    prerequisites: [{ id: 'harvest', rank: 3 }, { id: 'discount', rank: 1 }],
    effect: { type: 'breakthrough', perRank: 1 },
  },
  automation: {
    id: 'automation', name: '自動設備管理', maxRank: 1, costs: [1], minimumPrestigeCount: 1,
    prerequisites: [{ id: 'harvest', rank: 1 }], effect: { type: 'automation', perRank: 1 },
  },
} as const satisfies Record<SkillId, SkillDefinition>;

export const PRESTIGE_BALANCE = Object.freeze({ unlockScore: gn(100_000), earlyReward: 1, capReward: 2 });
export const PRESTIGE_REWARDS = [
  { score: gn(1e5), points: 1 }, { score: gn(1e6), points: 2 }, { score: gn(1e9), points: 3 },
  { score: gn(1e12), points: 4 }, { score: gn(1e15), points: 5 }, { score: gn(1e18), points: 6 },
] as const;
export const SKILL_RANK_LIMITS = [
  { harvest: 3, discount: 2, startingImo: 2 }, { harvest: 4, discount: 3, startingImo: 3 },
  { harvest: 5, discount: 4, startingImo: 4 }, { harvest: 6, discount: 5, startingImo: 5 },
  { harvest: 7, discount: 5, startingImo: 6 },
] as const;
export function skillRankLimit(id: SkillId, stage: ScoreCapStage): number {
  return isEnhancementSkill(id) ? SKILL_RANK_LIMITS[stage][id] : 1;
}
