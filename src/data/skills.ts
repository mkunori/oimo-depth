export const SKILL_IDS = ['harvest', 'discount', 'startingImo', 'breakthrough'] as const;
export type SkillId = typeof SKILL_IDS[number];

interface SkillDefinition {
  readonly id: SkillId;
  readonly name: string;
  readonly maxRank: number;
  readonly costs: readonly number[];
  readonly prerequisites: readonly { readonly id: SkillId; readonly rank: number }[];
  readonly minimumPrestigeCount: number;
  readonly effect: { readonly type: 'harvest' | 'discount' | 'startingImo' | 'breakthrough'; readonly perRank: number };
}

/** v0 の仮バランス。前提と効果をデータとして分離し、後続の枝を追加できる。 */
export const SKILLS = {
  harvest: {
    id: 'harvest', name: '豊かな収穫', maxRank: 3, costs: [1, 2, 3], prerequisites: [],
    minimumPrestigeCount: 0, effect: { type: 'harvest', perRank: 0.5 },
  },
  discount: {
    id: 'discount', name: '設備の目利き', maxRank: 2, costs: [1, 2],
    prerequisites: [{ id: 'harvest', rank: 1 }],
    minimumPrestigeCount: 0, effect: { type: 'discount', perRank: 10 },
  },
  startingImo: {
    id: 'startingImo', name: '旅立ちの蓄え', maxRank: 2, costs: [1, 2],
    prerequisites: [{ id: 'harvest', rank: 1 }],
    minimumPrestigeCount: 0, effect: { type: 'startingImo', perRank: 50 },
  },
  breakthrough: {
    id: 'breakthrough', name: '限界突破の心得', maxRank: 1, costs: [3], minimumPrestigeCount: 5,
    prerequisites: [{ id: 'harvest', rank: 3 }, { id: 'discount', rank: 1 }],
    effect: { type: 'breakthrough', perRank: 1 },
  },
} as const satisfies Record<SkillId, SkillDefinition>;

export const PRESTIGE_BALANCE = Object.freeze({ unlockScore: 100_000, earlyReward: 1, capReward: 2 });
