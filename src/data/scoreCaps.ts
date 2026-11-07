import { GameNumber, gn } from '../core/numbers';
import { INITIAL_BALANCE } from './balance';

/** 各段階の権限はcoreで検証する。 */
export const SCORE_CAP_STAGES = [
  { cap: INITIAL_BALANCE.scoreCap, requiredSkillRank: 0 },
  { cap: gn(1_000_000_000), requiredSkillRank: 1 },
  { cap: gn(1_000_000_000_000), requiredSkillRank: 1 },
] as const;
export type ScoreCapStage = 0 | 1 | 2;

export function getScoreCap(state: { readonly scoreCapStage: ScoreCapStage }): GameNumber {
  if (state.scoreCapStage !== 0 && state.scoreCapStage !== 1 && state.scoreCapStage !== 2) throw new RangeError('Unknown SCORE cap stage.');
  return SCORE_CAP_STAGES[state.scoreCapStage].cap;
}
