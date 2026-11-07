import { GEAR, GEAR_IDS } from '../data/gear';
import type { GearId } from '../data/gear';
import type { GameState, PermanentProgress } from './state';
import { GameNumber, gn } from './numbers';

export function gearIsReachable(id: GearId, state: Pick<GameState, 'scoreCapStage' | 'permanent'>) {
  return state.permanent.equipmentSystemUnlocked && state.permanent.rootRebirthCount >= GEAR[id].minimumRootCount
    && state.scoreCapStage >= GEAR[id].discoveryStage;
}
/** Called only when entering a stage/ROOT, never guesses post-ROOT history. */
export function discoverGear(state: GameState): GameState {
  const newlyFound = GEAR_IDS.filter((id) => !state.permanent.gearDiscovered[id] && gearIsReachable(id, state));
  if (newlyFound.length === 0) return state;
  return { ...state, permanent: { ...state.permanent, gearDiscovered: { ...state.permanent.gearDiscovered,
    ...Object.fromEntries(newlyFound.map((id) => [id, true])) } } };
}
/** A fixed ID order makes the huge-number ledger independent of purchase order. */
const spendTotals = new Map<number, GameNumber>();
export function getGearSpend(ids: readonly GearId[]) {
  const mask = GEAR_IDS.reduce((bits, id, index) => ids.includes(id) ? bits | (1 << index) : bits, 0);
  const cached = spendTotals.get(mask);
  if (cached) return cached;
  const value = GEAR_IDS.reduce((sum, id, index) => mask & (1 << index) ? sum.add(GEAR[id].price) : sum, gn(0));
  spendTotals.set(mask, value); // at most 32 immutable totals
  return value;
}
export function assertGearProgress(state: GameState): void {
  const { permanent, gearPurchasedThisRun: purchased, scoreSpentThisRun: spent } = state;
  if (!(spent instanceof GameNumber) || spent.lt(0) || spent.gt(state.runEarnedScore)
    || !Array.isArray(purchased) || purchased.length > GEAR_IDS.length) throw new RangeError('Invalid SCORE spending.');
  const unlocked = permanent.gearUnlocked, discovered = permanent.gearDiscovered;
  if (!unlocked || !discovered) throw new RangeError('Missing gear progress.');
  if (permanent.rootRebirthCount === 0 && purchased.length === 0 && spent.isZero()
    && GEAR_IDS.every((id) => unlocked[id] === false && discovered[id] === false)) return;
  for (const id of GEAR_IDS) {
    if (typeof unlocked[id] !== 'boolean' || typeof discovered[id] !== 'boolean'
      || (unlocked[id] && !discovered[id])
      || (discovered[id] && (!permanent.equipmentSystemUnlocked || permanent.rootRebirthCount < GEAR[id].minimumRootCount))
      || (gearIsReachable(id, state) && !discovered[id])) throw new RangeError('Invalid gear discovery or unlock.');
  }
  if (purchased.length === 0) { if (!spent.isZero()) throw new RangeError('SCORE spending has no receipt.'); return; }
  if (new Set(purchased).size !== purchased.length || purchased.some((id: GearId) => !GEAR_IDS.includes(id) || !unlocked[id] || !gearIsReachable(id, state))
    || !spent.equals(getGearSpend(purchased))) throw new RangeError('Gear receipts do not match SCORE spending.');
}
/** Passive-source boundary for #34: all unlocked gear is active; no modes here.
 * State entry points validate flags/ROOT gates before evaluating this effect. */
export function getGearMultiplier(permanent: PermanentProgress): number {
  if (permanent.rootRebirthCount === 0) return 1;
  return GEAR_IDS.reduce((value, id) => permanent.gearUnlocked[id] ? value * GEAR[id].passive.productionMultiplier : value, 1);
}
export function getSpendableScore(state: Pick<GameState, 'runEarnedScore' | 'scoreSpentThisRun'>) {
  return state.runEarnedScore.subtract(state.scoreSpentThisRun);
}
