import { getScoreCap, SCORE_CAP_STAGES } from '../data/scoreCaps';
import { getProductionPerSecond } from './game';
import type { GameState } from './state';

export function getBreakthrough(state: GameState) {
  getProductionPerSecond(state);
  const next = state.scoreCapStage === 0 ? SCORE_CAP_STAGES[1] : undefined;
  const reason = !next ? state.scoreCapStage === 1 ? '次は地層研究の深層解析でSCORE上限1E12へ突破できます。' : state.scoreCapStage === 2 ? '次は根脈接続解析でSCORE上限1E15へ突破できます。' : 'SCORE 上限1E15より先の限界突破は未実装です。'
    : state.permanent.skillRanks.breakthrough < next.requiredSkillRank ? '「限界突破の心得」を取得してください。転生とスキルで解禁できます。'
      : state.runEarnedScore.lt(getScoreCap(state)) ? `今周回のSCORE ${getScoreCap(state).format(7)} に到達すると突破できます。` : null;
  return { canBreakthrough: reason === null, nextCap: next?.cap ?? null, reason };
}

export function canBreakthrough(state: GameState): boolean { return getBreakthrough(state).canBreakthrough; }

/** スコアも残高も追加・リセットしない。同一周回の上限だけを変更する。 */
export function performBreakthrough(state: GameState): GameState {
  if (!canBreakthrough(state)) return state;
  if (state.permanent.maxDiscoveredStage >= 1) return { ...state, scoreCapStage: 1 };
  return { ...state, scoreCapStage: 1, permanent: { ...state.permanent, maxDiscoveredStage: state.permanent.maxDiscoveredStage < 1 ? 1 : state.permanent.maxDiscoveredStage } };
}
