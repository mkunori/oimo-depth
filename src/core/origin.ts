import { discoverGear } from './gearProgress';
import { getProductionPerSecond } from './game';
import type { GameState } from './state';

export function getOriginAnalysis(state: GameState) {
  getProductionPerSecond(state);
  const reason = state.scoreCapStage >= 4 ? '地底核心の解析は実行済みです。'
    : state.scoreCapStage !== 3 ? '根脈接続解析でSCORE上限1E15へ進むと解析できます。'
      : state.runEarnedScore.lt(1e15) ? 'この周回でSCORE 1E15に到達すると無料で解析できます。' : null;
  return { canAnalyze: reason === null, reason };
}

/** No reset, no research/depth gate. Permission survives normal prestige. */
export function performOriginAnalysis(state: GameState): GameState {
  if (!getOriginAnalysis(state).canAnalyze) return state;
  return discoverGear({ ...state, scoreCapStage: 4,
    permanent: { ...state.permanent, rootCycleMaxUnlockedStage: 4, originAnalysisUnlocked: true, maxDiscoveredStage: 4 } });
}
