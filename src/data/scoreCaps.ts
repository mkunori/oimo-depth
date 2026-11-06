import { INITIAL_BALANCE } from './balance';

/** 初回突破だけを実装。次の段階は仕様と検証を追加してから定義する。 */
export const SCORE_CAP_STAGES = [
  { cap: INITIAL_BALANCE.scoreCap, requiredSkillRank: 0 },
  { cap: 1_000_000_000, requiredSkillRank: 1 },
] as const;
export type ScoreCapStage = 0 | 1;

export function getScoreCap(state: { readonly scoreCapStage: ScoreCapStage }): number {
  if (state.scoreCapStage !== 0 && state.scoreCapStage !== 1) throw new RangeError('Unknown SCORE cap stage.');
  return SCORE_CAP_STAGES[state.scoreCapStage].cap;
}
