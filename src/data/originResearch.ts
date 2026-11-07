import { gn } from '../core/numbers';

export const ORIGIN_RESEARCH = {
  harvest: { name: '根源収穫学', costs: [gn(5e15), gn(5e16), gn(2e17)], multiplier: 1.5,
    description: '基礎・全設備・根脈リンクの収穫をランクごとに1.5倍にします。' },
  link: { name: '芋核共鳴', costs: [gn(2e15), gn(2e16), gn(1e17)], multiplier: 2,
    description: '根脈リンクの追加収穫だけをランクごとに2倍にします。' },
} as const;
export type OriginResearchId = keyof typeof ORIGIN_RESEARCH;
export type OriginResearchRanks = Readonly<Record<OriginResearchId, number>>;
export const ORIGIN_RESEARCH_IDS = Object.keys(ORIGIN_RESEARCH) as OriginResearchId[];
export function createEmptyOriginResearch(): OriginResearchRanks { return { harvest: 0, link: 0 }; }
export function getOriginResearchSpent(ranks: OriginResearchRanks) {
  return ORIGIN_RESEARCH_IDS.reduce((sum, id) => ORIGIN_RESEARCH[id].costs.slice(0, ranks[id]).reduce((a, b) => a.add(b), sum), gn(0));
}
export function originMultiplier(ranks: OriginResearchRanks, link = false): number {
  return ORIGIN_RESEARCH.harvest.multiplier ** ranks.harvest * (link ? ORIGIN_RESEARCH.link.multiplier ** ranks.link : 1);
}
