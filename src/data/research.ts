import { GameNumber, gn } from '../core/numbers';
/** 解放研究は恒久、強化研究のランクは周回ごと。返却額もこの価格表から求める。 */
export const RESEARCH = {
  geology: { name: '地層収穫学', costs: [gn(50_000_000), gn(200_000_000), gn(800_000_000)],
    effect: { scope: 'all', multiplierPerRank: 2 },
    description: '全収穫をランクごとに2倍（最大8倍）にします。' },
  resonance: { name: '地脈共鳴', costs: [gn(100_000_000), gn(500_000_000), gn(2_000_000_000)],
    effect: { scope: 'upper', multiplierPerRank: 2 },
    description: '地脈抽出機・芋濃縮炉の生産をランクごとに2倍（最大8倍）にします。' },
} as const;
export type ResearchId = keyof typeof RESEARCH;
export type ResearchRanks = Readonly<Record<ResearchId, number>>;
export const RESEARCH_IDS = Object.keys(RESEARCH) as ResearchId[];
export function createEmptyResearch(): ResearchRanks { return { geology: 0, resonance: 0 }; }
export function getResearchSpent(ranks: ResearchRanks): GameNumber {
  return RESEARCH_IDS.reduce((sum, id) => sum.add(RESEARCH[id].costs.slice(0, ranks[id]).reduce((a, b) => a.add(b), gn(0))), gn(0));
}
export function researchMultiplier(ranks: ResearchRanks, upper = false): number {
  return RESEARCH_IDS.reduce((multiplier, id) => multiplier
    * (RESEARCH[id].effect.scope === 'all' || upper ? RESEARCH[id].effect.multiplierPerRank ** ranks[id] : 1), 1);
}
