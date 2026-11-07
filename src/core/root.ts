import { discoverGear } from './gearProgress';
import { getProductionPerSecond, NumericProgressError } from './game';
import { getSkillBonuses } from './skills';
import { createInitialState } from './state';
import type { GameState } from './state';
import { ROOT_REWARDS, ROOT_UPGRADES } from '../data/root';
import type { RootUpgradeId } from '../data/root';

export function getRootRebirth(state: GameState) {
  getProductionPerSecond(state);
  const reward = [...ROOT_REWARDS].reverse().find((tier) => state.runEarnedScore.gte(tier.score));
  return { canRebirth: reward !== undefined, crystals: reward?.crystals ?? 0, nextCrystals: ROOT_REWARDS[0].crystals,
    requiredScore: ROOT_REWARDS[0].score, reason: reward ? null : '現周回でSCORE 1E18に到達するとROOT REBIRTHを実行できます。' };
}

/** Separate from normal prestige: no normal counter/points are awarded. */
export function performRootRebirth(state: GameState): GameState {
  const reward = getRootRebirth(state);
  if (!reward.canRebirth) return state;
  const before = state.permanent;
  const count = before.rootRebirthCount + 1, earned = before.totalRootCrystalsEarned + reward.crystals, balance = before.unspentRootCrystals + reward.crystals;
  if (![count, earned, balance].every(Number.isSafeInteger)) throw new NumericProgressError('ROOT counters exceed the safe integer range.');
  const permanent = { ...before, rootRebirthCount: count, totalRootCrystalsEarned: earned, unspentRootCrystals: balance, equipmentSystemUnlocked: true };
  const startingImo = getSkillBonuses(permanent).startingImo;
  return discoverGear({ ...createInitialState(), imo: startingImo, runStartingImo: startingImo, permanent, automation: state.automation });
}

export function getRootUpgradePurchase(state: GameState, id: RootUpgradeId) {
  getProductionPerSecond(state);
  if (!Object.hasOwn(ROOT_UPGRADES, id)) throw new RangeError('Unknown ROOT upgrade.');
  const definition = ROOT_UPGRADES[id], rank = state.permanent.rootUpgradeRanks[id], cost = definition.costs[rank] ?? null;
  const reason = !state.permanent.equipmentSystemUnlocked ? '初めてROOT REBIRTHを実行すると恒久強化を解禁します。'
    : cost === null ? '最大ランクです。'
      : definition.prerequisites.some((required) => state.permanent.rootUpgradeRanks[required.id] < required.rank) ? '前提のROOT強化が必要です。'
        : state.permanent.unspentRootCrystals < cost ? 'ROOT結晶が足りません。' : null;
  return { rank, cost, reason, canPurchase: reason === null };
}
export function purchaseRootUpgrade(state: GameState, id: RootUpgradeId): GameState {
  const quote = getRootUpgradePurchase(state, id);
  if (!quote.canPurchase || quote.cost === null) return state;
  return { ...state, permanent: { ...state.permanent,
    unspentRootCrystals: state.permanent.unspentRootCrystals - quote.cost,
    totalRootCrystalsSpent: state.permanent.totalRootCrystalsSpent + quote.cost,
    rootUpgradeRanks: { ...state.permanent.rootUpgradeRanks, [id]: quote.rank + 1 } } };
}
