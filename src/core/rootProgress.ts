import { ROOT_FIRST_PRODUCTION_MULTIPLIER, ROOT_UPGRADES, ROOT_UPGRADE_IDS } from '../data/root';
import type { PermanentProgress } from './state';

export function assertRootProgress(permanent: PermanentProgress): void {
  const { rootRebirthCount: count, unspentRootCrystals: balance, totalRootCrystalsEarned: earned,
    totalRootCrystalsSpent: spent, rootUpgradeRanks: ranks, equipmentSystemUnlocked: unlocked } = permanent;
  // The common pre-ROOT state has an exact, fully validated zero ledger. Avoid
  // allocating/scanning arrays on every fractional production tick in this case.
  if (count === 0 && balance === 0 && earned === 0 && spent === 0 && unlocked === false
    && ranks?.blessing === 0 && ranks.memory === 0 && ranks.adaptation === 0) return;
  if ([count, balance, earned, spent].some((value) => !Number.isSafeInteger(value) || value < 0)
    || earned !== count || balance > earned || spent !== earned - balance || typeof unlocked !== 'boolean'
    || unlocked !== (count > 0) || (count > 0 && (permanent.maxDiscoveredStage !== 4 || permanent.deepResearchCount < count))
    || !ranks || ROOT_UPGRADE_IDS.some((id) => !Number.isSafeInteger(ranks[id]) || ranks[id] < 0 || ranks[id] > ROOT_UPGRADES[id].costs.length
      || (ranks[id] > 0 && (!unlocked || ROOT_UPGRADES[id].prerequisites.some((required) => ranks[required.id] < required.rank))))) throw new RangeError('Invalid ROOT progress.');
  const paid = ROOT_UPGRADE_IDS.reduce((sum, id) => sum + ROOT_UPGRADES[id].costs.slice(0, ranks[id]).reduce<number>((a, b) => a + b, 0), 0);
  if (spent !== paid) throw new RangeError('ROOT crystal ledger does not match upgrades.');
}

const NO_ROOT_BONUSES = Object.freeze({ production: 1, startingImo: 0, lateAndDig: 1, priceMultiplier: 1 });

/** Like researchMultiplier, evaluate already validated progress. Core actions
 * and save loading validate the ledger at their state boundary; recalculating
 * an effect must not revalidate the same ledger for each equipment component.
 * No imports from game/skills/excavation (avoids cycles). */
export function getRootBonuses(permanent: PermanentProgress) {
  if (permanent.rootRebirthCount === 0) return NO_ROOT_BONUSES;
  const values = { production: permanent.rootRebirthCount > 0 ? ROOT_FIRST_PRODUCTION_MULTIPLIER : 1, startingImo: 0, lateAndDig: 1, priceMultiplier: 1 };
  for (const id of ROOT_UPGRADE_IDS) {
    const effect = ROOT_UPGRADES[id].effect, value = effect.values[permanent.rootUpgradeRanks[id]]!;
    if (effect.type === 'production') values.production *= value;
    if (effect.type === 'startingImo') { values.startingImo += value; values.priceMultiplier *= effect.priceMultipliers[permanent.rootUpgradeRanks[id]]!; }
    if (effect.type === 'lateAndDig') values.lateAndDig *= value;
  }
  return values;
}
