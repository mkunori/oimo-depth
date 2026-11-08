import { discoverGear } from './gearProgress';
import { getProductionPerSecond, NumericProgressError } from './game';
import { createInitialState } from './state';
import type { GameState } from './state';
import { getSkillBonuses, getSkillPurchase } from './skills';
import { PRESTIGE_REWARDS } from '../data/skills';
import type { SkillId } from '../data/skills';

export function getPrestigeReward(state: GameState): number {
  getProductionPerSecond(state); // 周回・恒久データを既存コアと同じ条件で検証する。
  return [...PRESTIGE_REWARDS].reverse().find((tier) => state.runEarnedScore.gte(tier.score))?.points ?? 0;
}

export function getNextPrestigeReward(state: GameState) {
  getProductionPerSecond(state);
  return PRESTIGE_REWARDS.find((tier) => state.runEarnedScore.lt(tier.score)) ?? null;
}

export function prestigeGame(state: GameState): GameState {
  const reward = getPrestigeReward(state);
  if (reward === 0) return state;
  if (!Number.isSafeInteger(state.permanent.lifetimePrestigeCount + 1) || !Number.isSafeInteger(state.permanent.prestigeCount + 1) || !Number.isSafeInteger(state.permanent.unspentPoints + reward) || !Number.isSafeInteger(state.permanent.lifetimePrestigePointsEarned + reward)) throw new NumericProgressError('Prestige counters would exceed the safe integer range.');
  const permanent = {
    ...state.permanent,
    prestigeCount: state.permanent.prestigeCount + 1,
    lifetimePrestigeCount: state.permanent.lifetimePrestigeCount + 1,
    unspentPoints: state.permanent.unspentPoints + reward,
    lifetimePrestigePointsEarned: state.permanent.lifetimePrestigePointsEarned + reward,
  };
  const startingImo = getSkillBonuses(permanent).startingImo;
  return discoverGear({ ...createInitialState(), imo: startingImo, runStartingImo: startingImo,
    scoreCapStage: permanent.deepAnalysisActiveThisRoot ? 2 : 0, runStartingScoreCapStage: permanent.deepAnalysisActiveThisRoot ? 2 : 0, permanent, automation: state.automation });
}

export function purchaseSkill(state: GameState, id: SkillId): GameState {
  getProductionPerSecond(state);
  const quote = getSkillPurchase(state.permanent, id, state.postDeepResearchSkillLock);
  if (!quote.canPurchase || quote.cost === null) return state;
  return {
    ...state,
    permanent: {
      ...state.permanent,
      unspentPoints: state.permanent.unspentPoints - quote.cost,
      skillRanks: { ...state.permanent.skillRanks, [id]: quote.nextRank },
    },
  };
}
