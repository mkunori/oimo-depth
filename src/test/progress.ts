import { advanceGame, getAmountSeconds, getProductionPerSecond, purchaseEquipment } from '../core/game';
import type { GameState } from '../core/state';
import { gn } from '../core/numbers';
import { performRootConnection } from '../core/rootConnection';
import { performOriginAnalysis } from '../core/origin';
import { prestigeGame, purchaseSkill } from '../core/prestige';
import { createInitialState } from '../core/state';
import { performBreakthrough } from '../core/breakthrough';
import { performDeepResearch } from '../core/research';
import { parseSave } from '../core/save';
import { readFileSync } from 'node:fs';

/** 本番と同じ転生・支出を経由した、初回突破の確認直前の状態。 */
export function createBreakthroughReadyState() {
  let state = createInitialState();
  for (let run = 0; run < 5; run += 1) state = prestigeGame(advanceGame(state, 1e6));
  for (const id of ['harvest', 'harvest', 'harvest', 'discount', 'breakthrough'] as const) state = purchaseSkill(state, id);
  return advanceGame(state, 1e6);
}

export function createAutomationReadyState() {
  const state = purchaseSkill(prestigeGame(advanceGame(createInitialState(), 1e6)), 'harvest');
  return purchaseSkill(state, 'automation');
}

export function createResearchReadyState(automation = false) {
  let state = createBreakthroughReadyState();
  if (automation) state = advanceGame(purchaseSkill(prestigeGame(state), 'automation'), 1e6);
  return advanceGame(performBreakthrough(state), 1e9);
}

export function createRootConnectionReadyState(automation = false) {
  return advanceGame(performDeepResearch(createResearchReadyState(automation)), Number.MAX_VALUE);
}

export function createRootRebirthReadyState() {
  const origin = performOriginAnalysis(advanceGame(performRootConnection(createRootConnectionReadyState(true)), Number.MAX_VALUE));
  return advanceGame(purchaseEquipment(advanceGame(origin, 1e15), 'originMiner', 1), Number.MAX_VALUE);
}

/** Continue an actual analyzed run through both later breakthroughs and fund an
 * origin miner before the final cap, keeping DEPTH within its supported range. */
export function completeAnalyzedRootCycle(initial: GameState): GameState {
  let state = advanceGame(performRootConnection(advanceGame(initial, Number.MAX_VALUE)), Number.MAX_VALUE);
  state = performOriginAnalysis(state);
  const seconds = getAmountSeconds(gn(3e15).subtract(state.runEarnedScore), getProductionPerSecond(state))!;
  state = advanceGame(state, seconds);
  return advanceGame(purchaseEquipment(state, 'originMiner', 1), Number.MAX_VALUE);
}

/** Fund test allocations through actual manual prestiges, never inventing ledger entries. */
export function buyTestEnhancements(initial: GameState, targets = { harvest: 3, discount: 2, startingImo: 1 }): GameState {
  let state = initial;
  for (const id of ['harvest', 'discount', 'startingImo'] as const) {
    for (let step = 0; state.permanent.skillRanks[id] < targets[id]; step += 1) {
      if (step > 40) throw new Error('Test allocation cannot be funded.');
      const next = purchaseSkill(state, id);
      state = next === state ? prestigeGame(advanceGame(state, Number.MAX_VALUE)) : next;
    }
  }
  return state;
}

/** Build old-format fixtures under the old refund rule, before serializing them
 * with a legacy version. Production migration must never repair invalid ledgers. */
export function withLegacyRefunds(state: GameState): GameState {
  return { ...state, permanent: { ...state.permanent,
    unspentPoints: state.permanent.unspentPoints + state.permanent.pointsLostByDeepResearch,
    pointsLostByDeepResearch: 0 } };
}

/** Rebuild the lower loop with real capped prestiges and paid prerequisites. */
export function createNextRootAnalysisReadyState(initial: GameState): GameState {
  let state = buyTestEnhancements(initial, { harvest: 3, discount: 1, startingImo: 0 });
  for (let step = 0; state.permanent.skillRanks.breakthrough === 0; step += 1) {
    if (step > 20) throw new Error('ROOT rebuild cannot acquire breakthrough.');
    const next = purchaseSkill(state, 'breakthrough');
    state = next === state ? prestigeGame(advanceGame(state, Number.MAX_VALUE)) : next;
  }
  return advanceGame(performBreakthrough(advanceGame(state, Number.MAX_VALUE)), Number.MAX_VALUE);
}

export function createLegacyRootState(): GameState {
  return parseSave(readFileSync(new URL('./fixtures/save-v16-root.json', import.meta.url), 'utf8')).gameState;
}
