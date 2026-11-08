import { ENHANCEMENT_SKILL_IDS, SKILLS, SKILL_IDS, skillRankLimit } from '../data/skills';
import type { PermanentProgress } from './state';

export function getSkillPointsSpent(ranks: PermanentProgress['skillRanks']): number {
  return SKILL_IDS.reduce((sum, id) => sum + SKILLS[id].costs.slice(0, ranks[id]).reduce<number>((total, cost) => total + cost, 0), 0);
}
/** Validate the old economic rules before initializing a new ledger. Never
 * reinterpret past resets with the new reward table or claw back old refunds. */
export function migrateLegacyPrestigePoints(p: PermanentProgress) {
  if (!Number.isSafeInteger(p.prestigeCount) || p.prestigeCount < 0 || !Number.isSafeInteger(p.unspentPoints) || p.unspentPoints < 0
    || SKILL_IDS.some((id) => !Number.isSafeInteger(p.skillRanks[id]) || p.skillRanks[id] < 0 || p.skillRanks[id] > skillRankLimit(id, 0))) throw new RangeError('Invalid legacy points.');
  const total = getSkillPointsSpent(p.skillRanks) + p.unspentPoints;
  if (!Number.isSafeInteger(total) || total < p.prestigeCount || total > p.prestigeCount * 2
    || (p.deepResearchCount > 0 && total < 10 + p.skillRanks.automation)) throw new RangeError('Invalid legacy point history.');
  return { lifetimePrestigePointsEarned: total, pointsLostByDeepResearch: 0, pointsLostByRoot: 0 };
}
const MAX_ANALYSIS_LOSS = ENHANCEMENT_SKILL_IDS.reduce((sum, id) => sum + SKILLS[id].costs.reduce<number>((total, cost) => total + cost, 0), 0);
export function assertPrestigePoints(p: PermanentProgress, spent = getSkillPointsSpent(p.skillRanks)): void {
  const { lifetimePrestigePointsEarned: earned, pointsLostByDeepResearch: lost, pointsLostByRoot: rootLost } = p;
  const accounted = spent + p.unspentPoints + lost + rootLost;
  if ([earned, lost, rootLost, accounted].some((value) => !Number.isSafeInteger(value) || value < 0)
    || accounted !== earned || earned < p.lifetimePrestigeCount || Math.ceil(earned / 6) > p.lifetimePrestigeCount
    || (rootLost > 0 && p.rootRebirthCount === 0)
    || Math.ceil(lost / MAX_ANALYSIS_LOSS) > p.deepResearchCount
    || (p.deepResearchCount > 0 && earned < 10 + p.skillRanks.automation)) throw new RangeError('Prestige point ledger does not balance.');
}
