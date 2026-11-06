import { advanceGame } from '../core/game';
import { prestigeGame, purchaseSkill } from '../core/prestige';
import { createInitialState } from '../core/state';
import { performBreakthrough } from '../core/breakthrough';

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
