import { createEmptyResearch, getResearchSpent, RESEARCH } from '../data/research';
import type { ResearchId } from '../data/research';
import { getScoreCap } from '../data/scoreCaps';
import { getProductionPerSecond } from './game';
import type { GameState } from './state';

export function getDeepResearch(state: GameState) {
  getProductionPerSecond(state);
  const reason = state.scoreCapStage === 2 ? '深層解析による突破は実行済みです。'
    : state.scoreCapStage !== 1 ? '初回限界突破でSCORE上限1E9へ進むと研究できます。'
      : state.runEarnedScore < 1e9 ? 'この周回でSCORE 1E9に到達すると、無料で研究による突破ができます。' : null;
  return { canResearch: reason === null, reason };
}

/** 解放は無償で確定。権限と周回段階を分け、再到達時も同じ操作で突破する。 */
export function performDeepResearch(state: GameState): GameState {
  if (!getDeepResearch(state).canResearch) return state;
  return { ...state, scoreCapStage: 2, permanent: { ...state.permanent, deepResearchUnlocked: true } };
}

export function getResearchPurchase(state: GameState, id: ResearchId) {
  getProductionPerSecond(state);
  if (!Object.hasOwn(RESEARCH, id)) throw new RangeError('Unknown research.');
  const rank = state.researchRanks[id];
  const cost = RESEARCH[id].costs[rank] ?? null;
  const reason = state.scoreCapStage !== 2 ? '研究による突破でSCORE上限1E12へ進むと強化できます。'
    : state.runEarnedScore >= getScoreCap(state) ? 'SCORE上限到達のため購入を停止しています。'
      : cost === null ? '最大ランクです。' : state.imo < cost ? '所持芋が足りません。' : null;
  return { cost, rank, canPurchase: reason === null, reason };
}

export function purchaseResearch(state: GameState, id: ResearchId): GameState {
  const quote = getResearchPurchase(state, id);
  if (!quote.canPurchase || quote.cost === null) return state;
  return { ...state, imo: state.imo - quote.cost,
    researchRanks: { ...state.researchRanks, [id]: quote.rank + 1 } };
}

/** 同じ周回内で配分を試し直せる。返金はSCOREに加算しない。 */
export function resetResearch(state: GameState): GameState {
  getProductionPerSecond(state);
  const refund = getResearchSpent(state.researchRanks);
  if (state.scoreCapStage !== 2 || state.runEarnedScore >= getScoreCap(state) || refund === 0) return state;
  return { ...state, imo: state.imo + refund, researchRanks: createEmptyResearch() };
}
