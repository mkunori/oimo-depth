import { assertPrestigePoints } from './prestigePoints';
import { assertRootProgress, getRootBonuses } from './rootProgress';
import { SKILLS, SKILL_IDS, isEnhancementSkill, skillRankLimit } from '../data/skills';
import type { SkillId } from '../data/skills';
import type { PermanentProgress } from './state';
import { gn } from './numbers';
import { assertExcavation } from './excavation';

export function assertPermanentProgress(permanent: PermanentProgress, allowHistoricalUnlocks = true): void {
  assertRootProgress(permanent);
  assertExcavation(permanent);
  const legacy = permanent.legacyRootProgress;
  const permissionStage = legacy ? permanent.maxDiscoveredStage : permanent.rootCycleMaxUnlockedStage;
  if (![0, 1, 2, 3, 4].includes(permanent.maxDiscoveredStage)
    || typeof permanent.originAnalysisUnlocked !== 'boolean'
    || permanent.originAnalysisUnlocked !== (permissionStage === 4)
    || typeof permanent.rootConnectionUnlocked !== 'boolean'
    || permanent.rootConnectionUnlocked !== (permissionStage >= 3)
    || (permissionStage >= 1 && permanent.skillRanks.breakthrough < 1)
    || (permissionStage >= 2) !== permanent.deepResearchUnlocked) throw new RangeError('Invalid discovery or current permission.');
  if (typeof permanent.deepAnalysisActiveThisRoot !== 'boolean'
    || (permanent.deepAnalysisActiveThisRoot && (!permanent.deepResearchUnlocked || permanent.deepResearchCount <= permanent.rootRebirthCount))
    || (permanent.rootRebirthCount === 0 && permanent.deepResearchCount > 0 && !permanent.deepAnalysisActiveThisRoot)) throw new RangeError('Invalid current ROOT analysis.');
  // Preserve the bound on legacy repeated analyses; normal prestige no longer adds an analysis.
  if (!Number.isSafeInteger(permanent.deepResearchCount) || permanent.deepResearchCount < 0
    || (permanent.deepResearchUnlocked && permanent.deepResearchCount === 0)
    || permanent.deepResearchCount - permanent.rootRebirthCount > Math.max(0, permanent.lifetimePrestigeCount - 4)) throw new RangeError('Invalid deep research history.');
  if (typeof permanent.deepResearchUnlocked !== 'boolean'
    || (permanent.deepResearchUnlocked && permanent.skillRanks.breakthrough < 1)) throw new RangeError('Invalid deep research permission.');
  if (!Number.isSafeInteger(permanent.lifetimePrestigeCount) || permanent.lifetimePrestigeCount < permanent.prestigeCount
    || !Number.isSafeInteger(permanent.prestigeCount) || permanent.prestigeCount < 0
    || !Number.isSafeInteger(permanent.unspentPoints) || permanent.unspentPoints < 0) {
    throw new RangeError('Invalid prestige count or points.');
  }
  const cycleStage = permanent.rootCycleMaxUnlockedStage;
  if (![0, 1, 2, 3, 4].includes(cycleStage) || cycleStage > permanent.maxDiscoveredStage
    || (cycleStage >= 2) !== permanent.deepAnalysisActiveThisRoot) throw new RangeError('Invalid ROOT cycle stage.');
  let spent = 0;
  for (const id of SKILL_IDS) {
    const rank = permanent.skillRanks[id];
    const definition = SKILLS[id];
    if (!Number.isSafeInteger(rank) || rank < 0 || rank > skillRankLimit(id, permanent.maxDiscoveredStage)
      || (rank > skillRankLimit(id, cycleStage) && !legacy)) {
      throw new RangeError('Invalid skill rank.');
    }
    if (rank > 0 && (permanent.prestigeCount < definition.minimumPrestigeCount
      || ((!allowHistoricalUnlocks || isEnhancementSkill(id) || !permanent.deepResearchUnlocked)
        && definition.prerequisites.some((required) => permanent.skillRanks[required.id] < required.rank)))) {
      throw new RangeError('Skill prerequisites are not satisfied.');
    }
    spent += definition.costs.slice(0, rank).reduce<number>((sum, cost) => sum + cost, 0);
  }
  assertPrestigePoints(permanent, spent);
}

export function getSkillBonuses(permanent: PermanentProgress) {
  assertPermanentProgress(permanent);
  const bonuses = { productionMultiplier: 1, equipmentPriceMultiplier: 1, equipmentDiscountPercent: 0, startingImo: gn(0) };
  for (const id of SKILL_IDS) {
    const effect = SKILLS[id].effect;
    const amount = effect.type === 'startingImo' ? effect.values[permanent.skillRanks[id]]! : permanent.skillRanks[id] * effect.perRank;
    if (effect.type === 'harvest') bonuses.productionMultiplier += amount;
    if (effect.type === 'discount') bonuses.equipmentDiscountPercent += amount;
    if (effect.type === 'startingImo') bonuses.startingImo = bonuses.startingImo.add(amount);
  }
  const root = getRootBonuses(permanent);
  bonuses.startingImo = bonuses.startingImo.add(root.startingImo);
  bonuses.equipmentPriceMultiplier = (1 - bonuses.equipmentDiscountPercent / 100) * root.priceMultiplier;
  return { ...bonuses, productionMultiplier: gn(bonuses.productionMultiplier).multiply(root.production) };
}

export function getSkillPurchase(permanent: PermanentProgress, id: SkillId, postDeepResearchSkillLock = false) {
  assertPermanentProgress(permanent);
  if (!Object.hasOwn(SKILLS, id)) throw new RangeError('Unknown skill.');
  const definition = SKILLS[id];
  const rank = permanent.skillRanks[id];
  const maxRank = skillRankLimit(id, permanent.rootCycleMaxUnlockedStage);
  const cost = rank >= maxRank ? null : definition.costs[rank] ?? null;
  const reason = id === 'automation' && permanent.rootAutomationUnlocked ? 'ROOTで自動購入を恒久解禁済みです。スキルの再購入は不要です。'
    : postDeepResearchSkillLock && isEnhancementSkill(id) ? '深層解析後の強化スキルは、この周回では再購入できません。'
    : rank >= maxRank ? '最大ランクに到達しています。'
    : definition.prerequisites.some((required) => permanent.skillRanks[required.id] < required.rank)
      ? '前提スキルが未取得です。'
      : permanent.prestigeCount < definition.minimumPrestigeCount ? `累計転生${definition.minimumPrestigeCount}回が必要です。`
        : cost !== null && permanent.unspentPoints < cost ? '転生ポイントが足りません。' : null;
  return { cost, maxRank, nextRank: rank >= maxRank ? rank : rank + 1, reason, canPurchase: reason === null };
}
