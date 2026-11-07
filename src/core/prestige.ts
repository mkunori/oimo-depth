import { getProductionPerSecond, NumericProgressError } from './game';
import { createInitialState } from './state';
import type { GameState } from './state';
import { getSkillBonuses, getSkillPurchase } from './skills';
import { INITIAL_BALANCE } from '../data/balance';
import { PRESTIGE_BALANCE } from '../data/skills';
import type { SkillId } from '../data/skills';

export function getPrestigeReward(state: GameState): number {
  getProductionPerSecond(state); // 周回・恒久データを既存コアと同じ条件で検証する。
  if (state.runEarnedScore.lt(PRESTIGE_BALANCE.unlockScore)) return 0;
  return state.runEarnedScore.gte(INITIAL_BALANCE.scoreCap) ? PRESTIGE_BALANCE.capReward : PRESTIGE_BALANCE.earlyReward;
}

export function prestigeGame(state: GameState): GameState {
  const reward = getPrestigeReward(state);
  if (reward === 0) return state;
  if (!Number.isSafeInteger(state.permanent.prestigeCount + 1) || !Number.isSafeInteger(state.permanent.unspentPoints + reward)) throw new NumericProgressError('Prestige counters would exceed the safe integer range.');
  const permanent = {
    ...state.permanent,
    prestigeCount: state.permanent.prestigeCount + 1,
    unspentPoints: state.permanent.unspentPoints + reward,
  };
  const startingImo = getSkillBonuses(permanent).startingImo;
  return { ...createInitialState(), imo: startingImo, runStartingImo: startingImo, permanent, automation: state.automation };
}

export function purchaseSkill(state: GameState, id: SkillId): GameState {
  getProductionPerSecond(state);
  const quote = getSkillPurchase(state.permanent, id);
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
