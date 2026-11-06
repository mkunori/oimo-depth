import { SKILLS, SKILL_IDS } from '../data/skills';
import type { SkillId } from '../data/skills';
import type { PermanentProgress } from './state';

export function assertPermanentProgress(permanent: PermanentProgress): void {
  if (typeof permanent.deepResearchUnlocked !== 'boolean'
    || (permanent.deepResearchUnlocked && permanent.skillRanks.breakthrough < 1)) throw new RangeError('Invalid deep research permission.');
  if (!Number.isSafeInteger(permanent.prestigeCount) || permanent.prestigeCount < 0
    || !Number.isSafeInteger(permanent.unspentPoints) || permanent.unspentPoints < 0) {
    throw new RangeError('Invalid prestige count or points.');
  }
  let spent = 0;
  for (const id of SKILL_IDS) {
    const rank = permanent.skillRanks[id];
    const definition = SKILLS[id];
    if (!Number.isSafeInteger(rank) || rank < 0 || rank > definition.maxRank) {
      throw new RangeError('Invalid skill rank.');
    }
    if (rank > 0 && (permanent.prestigeCount < definition.minimumPrestigeCount
      || definition.prerequisites.some((required) => permanent.skillRanks[required.id] < required.rank))) {
      throw new RangeError('Skill prerequisites are not satisfied.');
    }
    spent += definition.costs.slice(0, rank).reduce<number>((sum, cost) => sum + cost, 0);
  }
  const total = spent + permanent.unspentPoints;
  if (!Number.isSafeInteger(total) || total < permanent.prestigeCount || total > permanent.prestigeCount * 2) {
    throw new RangeError('Points do not match the prestige history.');
  }
}

export function getSkillBonuses(permanent: PermanentProgress) {
  assertPermanentProgress(permanent);
  const bonuses = { productionMultiplier: 1, equipmentPriceMultiplier: 1, equipmentDiscountPercent: 0, startingImo: 0 };
  for (const id of SKILL_IDS) {
    const effect = SKILLS[id].effect;
    const amount = permanent.skillRanks[id] * effect.perRank;
    if (effect.type === 'harvest') bonuses.productionMultiplier += amount;
    if (effect.type === 'discount') bonuses.equipmentDiscountPercent += amount;
    if (effect.type === 'startingImo') bonuses.startingImo += amount;
  }
  bonuses.equipmentPriceMultiplier = 1 - bonuses.equipmentDiscountPercent / 100;
  return bonuses;
}

export function getSkillPurchase(permanent: PermanentProgress, id: SkillId) {
  assertPermanentProgress(permanent);
  if (!Object.hasOwn(SKILLS, id)) throw new RangeError('Unknown skill.');
  const definition = SKILLS[id];
  const rank = permanent.skillRanks[id];
  const cost = definition.costs[rank] ?? null;
  const reason = rank >= definition.maxRank ? '最大ランクに到達しています。'
    : definition.prerequisites.some((required) => permanent.skillRanks[required.id] < required.rank)
      ? '前提スキルが未取得です。'
      : permanent.prestigeCount < definition.minimumPrestigeCount ? `累計転生${definition.minimumPrestigeCount}回が必要です。`
        : cost !== null && permanent.unspentPoints < cost ? '転生ポイントが足りません。' : null;
  return { cost, nextRank: Math.min(rank + 1, definition.maxRank), reason, canPurchase: reason === null };
}
