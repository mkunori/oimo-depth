import { getProductionPerSecond } from './game';
import type { GameState } from './state';

export function getRootConnection(state: GameState) {
  getProductionPerSecond(state);
  const reason = state.scoreCapStage === 3 ? '根脈接続解析は実行済みです。'
    : state.scoreCapStage !== 2 ? '深層解析でSCORE上限1E12へ進むと接続解析できます。'
      : state.runEarnedScore.lt(1e12) ? 'この周回でSCORE 1E12に到達すると無料で接続解析できます。' : null;
  return { canConnect: reason === null, reason };
}

/** No resource or skill reset: the discovery and permission survive normal prestige. */
export function performRootConnection(state: GameState): GameState {
  if (!getRootConnection(state).canConnect) return state;
  return { ...state, scoreCapStage: 3,
    permanent: { ...state.permanent, rootConnectionUnlocked: true, maxDiscoveredStage: 3 } };
}
