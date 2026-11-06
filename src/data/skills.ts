export const SKILL_IDS = ['harvest', 'discount', 'startingImo'] as const;
export type SkillId = typeof SKILL_IDS[number];

interface SkillDefinition {
  readonly id: SkillId;
  readonly name: string;
  readonly maxRank: number;
  readonly costs: readonly number[];
  readonly prerequisites: readonly { readonly id: SkillId; readonly rank: number }[];
  readonly effect: { readonly type: 'harvest' | 'discount' | 'startingImo'; readonly perRank: number };
}

/** v0 の仮バランス。前提と効果をデータとして分離し、後続の枝を追加できる。 */
export const SKILLS = {
  harvest: {
    id: 'harvest', name: '豊かな収穫', maxRank: 3, costs: [1, 2, 3], prerequisites: [],
    effect: { type: 'harvest', perRank: 0.5 },
  },
  discount: {
    id: 'discount', name: '設備の目利き', maxRank: 2, costs: [1, 2],
    prerequisites: [{ id: 'harvest', rank: 1 }],
    effect: { type: 'discount', perRank: 10 },
  },
  startingImo: {
    id: 'startingImo', name: '旅立ちの蓄え', maxRank: 2, costs: [1, 2],
    prerequisites: [{ id: 'harvest', rank: 1 }],
    effect: { type: 'startingImo', perRank: 50 },
  },
} as const satisfies Record<SkillId, SkillDefinition>;

export const PRESTIGE_BALANCE = Object.freeze({ unlockScore: 100_000, earlyReward: 1, capReward: 2 });
