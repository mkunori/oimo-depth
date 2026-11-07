import { DIG_RESEARCH } from '../data/depth';
import type { DigResearchId } from '../data/depth';
import { getScoreCap } from '../data/scoreCaps';
import { getProductionPerSecond } from './game';
import type { GameState } from './state';

export function getDigResearchPurchase(state: GameState, id: DigResearchId) {
  getProductionPerSecond(state);
  if (!Object.hasOwn(DIG_RESEARCH, id)) throw new RangeError('Unknown dig research.');
  const rank = state.permanent.digResearchRanks[id], definition = DIG_RESEARCH[id];
  const cost = definition.costs[rank] ?? null;
  const reason = state.permanent.depthMeters < definition.unlockDepth ? '未発見の掘削研究です。'
    : state.runEarnedScore.gte(getScoreCap(state)) ? 'SCORE上限到達のため購入を停止しています。'
      : cost === null ? '最大ランクです。' : state.imo.lt(cost) ? '所持芋が足りません。' : null;
  return { rank, cost, reason, canPurchase: reason === null };
}
export function purchaseDigResearch(state: GameState, id: DigResearchId): GameState {
  const quote = getDigResearchPurchase(state, id);
  if (!quote.canPurchase || quote.cost === null) return state;
  return { ...state, imo: state.imo.subtract(quote.cost), permanent: { ...state.permanent,
    digResearchRanks: { ...state.permanent.digResearchRanks, [id]: quote.rank + 1 } } };
}
