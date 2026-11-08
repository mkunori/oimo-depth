import { discoverGear } from './gearProgress';
import { createEmptyOriginResearch, getOriginResearchSpent, ORIGIN_RESEARCH } from '../data/originResearch';
import type { OriginResearchId } from '../data/originResearch';
import { createEmptyResearch, getResearchSpent, RESEARCH } from '../data/research';
import type { ResearchId } from '../data/research';
import { getScoreCap } from '../data/scoreCaps';
import { getProductionPerSecond, NumericProgressError } from './game';
import type { GameState } from './state';
import { ENHANCEMENT_SKILL_IDS, SKILLS } from '../data/skills';

export type DeepMemoryChoice = 'discount' | 'startingImo';
export function getDeepMemorySlots(count: number): number { return Math.min(3, Math.max(0, count - 1)); }

/** Preview and execution share the same rank/loss calculation. Choice matters only on the third analysis. */
export function getDeepResearchReset(state: GameState, choice: DeepMemoryChoice = 'discount') {
  if (choice !== 'discount' && choice !== 'startingImo') throw new RangeError('Invalid deep memory choice.');
  const active = state.permanent.deepAnalysisActiveThisRoot;
  const count = state.permanent.deepResearchCount + (active ? 0 : 1);
  if (!Number.isSafeInteger(count)) throw new NumericProgressError('Deep research count exceeds the safe integer range.');
  const slots = getDeepMemorySlots(count);
  const kept = ENHANCEMENT_SKILL_IDS.filter((id) => active || slots === 3 || (slots >= 1 && id === 'harvest') || (slots === 2 && id === choice));
  const lost = ENHANCEMENT_SKILL_IDS.filter((id) => !kept.includes(id)).map((id) => ({ id, rank: state.permanent.skillRanks[id] }));
  const pointsLost = lost.reduce((sum, { id, rank }) => sum + SKILLS[id].costs.slice(0, rank).reduce<number>((total, cost) => total + cost, 0), 0);
  return { count, slots, kept, lost, pointsLost, locked: !active && slots < 3 };
}

export function getDeepResearch(state: GameState) {
  getProductionPerSecond(state);
  const reason = state.permanent.deepAnalysisActiveThisRoot || state.scoreCapStage >= 2 ? '現ROOT周回の深層解析は完了済みです。通常転生後も上限1E12を維持します。'
    : state.scoreCapStage !== 1 ? '初回限界突破でSCORE上限1E9へ進むと研究できます。'
      : state.runEarnedScore.lt(1e9) ? 'この周回でSCORE 1E9に到達すると、無料で研究による突破ができます。' : null;
  return { canResearch: reason === null, reason };
}

/** 資産は持ち越し、保持枠外の使用済みポイントは台帳の消失へ移す。 */
export function performDeepResearch(state: GameState, choice: DeepMemoryChoice = 'discount'): GameState {
  if (!getDeepResearch(state).canResearch) return state;
  const reset = getDeepResearchReset(state, choice);
  if (reset.count - state.permanent.rootRebirthCount > state.permanent.lifetimePrestigeCount - 4) throw new NumericProgressError('Deep research count exceeds the prestige history.');
  const pointsLostByDeepResearch = state.permanent.pointsLostByDeepResearch + reset.pointsLost;
  if (!Number.isSafeInteger(pointsLostByDeepResearch)) throw new NumericProgressError('Lost points exceed the safe integer range.');
  const skillRanks = { ...state.permanent.skillRanks };
  for (const { id } of reset.lost) skillRanks[id] = 0;
  return discoverGear({ ...state, scoreCapStage: 2, postDeepResearchSkillLock: reset.locked,
    permanent: { ...state.permanent, maxDiscoveredStage: state.permanent.maxDiscoveredStage < 2 ? 2 : state.permanent.maxDiscoveredStage,
      deepAnalysisActiveThisRoot: true, deepResearchUnlocked: true, deepResearchCount: reset.count, rootCycleMaxUnlockedStage: Math.max(2, state.permanent.rootCycleMaxUnlockedStage) as GameState['scoreCapStage'], pointsLostByDeepResearch, skillRanks } });
}

export function getResearchPurchase(state: GameState, id: ResearchId) {
  getProductionPerSecond(state);
  if (!Object.hasOwn(RESEARCH, id)) throw new RangeError('Unknown research.');
  const rank = state.researchRanks[id];
  const cost = RESEARCH[id].costs[rank] ?? null;
  const reason = state.scoreCapStage < 2 ? '研究による突破でSCORE上限1E12へ進むと強化できます。'
    : state.runEarnedScore.gte(getScoreCap(state)) ? 'SCORE上限到達のため購入を停止しています。'
      : cost === null ? '最大ランクです。' : state.imo.lt(cost) ? '所持芋が足りません。' : null;
  return { cost, rank, canPurchase: reason === null, reason };
}

export function purchaseResearch(state: GameState, id: ResearchId): GameState {
  const quote = getResearchPurchase(state, id);
  if (!quote.canPurchase || quote.cost === null) return state;
  return { ...state, imo: state.imo.subtract(quote.cost),
    researchRanks: { ...state.researchRanks, [id]: quote.rank + 1 } };
}

/** 同じ周回内で配分を試し直せる。返金はSCOREに加算しない。 */
export function resetResearch(state: GameState): GameState {
  getProductionPerSecond(state);
  const refund = getResearchSpent(state.researchRanks).add(getOriginResearchSpent(state.originResearchRanks));
  if (state.scoreCapStage < 2 || state.runEarnedScore.gte(getScoreCap(state)) || refund.equals(0)) return state;
  return { ...state, imo: state.imo.add(refund), researchRanks: createEmptyResearch(), originResearchRanks: createEmptyOriginResearch() };
}

export function getOriginResearchPurchase(state: GameState, id: OriginResearchId) {
  getProductionPerSecond(state);
  if (!Object.hasOwn(ORIGIN_RESEARCH, id)) throw new RangeError('Unknown origin research.');
  const rank = state.originResearchRanks[id];
  const cost = ORIGIN_RESEARCH[id].costs[rank] ?? null;
  const reason = state.scoreCapStage < 4 ? '地底核心の解析でSCORE上限1E18へ進むと強化できます。'
    : state.runEarnedScore.gte(getScoreCap(state)) ? 'SCORE上限到達のため購入を停止しています。'
      : cost === null ? '最大ランクです。' : state.imo.lt(cost) ? '所持芋が足りません。' : null;
  return { cost, rank, canPurchase: reason === null, reason };
}
export function purchaseOriginResearch(state: GameState, id: OriginResearchId): GameState {
  const quote = getOriginResearchPurchase(state, id);
  if (!quote.canPurchase || quote.cost === null) return state;
  return { ...state, imo: state.imo.subtract(quote.cost),
    originResearchRanks: { ...state.originResearchRanks, [id]: quote.rank + 1 } };
}
