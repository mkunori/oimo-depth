import { reconcileGearPreset } from './gearModeEffects';
import { GEAR, GEAR_IDS } from '../data/gear';
import type { GearId } from '../data/gear';
import type { GameState } from './state';
import { getProductionPerSecond } from './game';
import { gearIsReachable, getGearSpend, getSpendableScore } from './gearProgress';

export function getGearUnlock(state: GameState, id: GearId) {
  getProductionPerSecond(state);
  if (!Object.hasOwn(GEAR, id)) throw new RangeError('Unknown gear.');
  const definition = GEAR[id], purchased = GEAR_IDS.filter((gear) => state.gearPurchasedThisRun.includes(gear) || gear === id);
  const spentAfter = getGearSpend(purchased);
  const reason = !state.permanent.equipmentSystemUnlocked ? '初めてROOT REBIRTHを実行すると装備を解禁できます。'
    : state.permanent.gearUnlocked[id] ? '恒久解禁済みです。常時効果が有効です。'
      : state.permanent.rootRebirthCount < definition.minimumRootCount ? `ROOT ${definition.minimumRootCount}回が必要です。`
        : !state.permanent.gearDiscovered[id] || !gearIsReachable(id, state) ? 'この周回は上限段階の再突破が必要です。'
          : getSpendableScore(state).lt(definition.price) || spentAfter.gt(state.runEarnedScore) ? '利用可能SCOREが足りません。' : null;
  return { canUnlock: reason === null, reason, price: definition.price, spentAfter, purchased };
}
/** SCORE receipts only: never debit cumulative SCORE, imo or ROOT crystals. */
export function unlockGear(state: GameState, id: GearId): GameState {
  const quote = getGearUnlock(state, id);
  if (!quote.canUnlock) return state;
  return { ...state, scoreSpentThisRun: quote.spentAfter, gearPurchasedThisRun: quote.purchased,
    permanent: reconcileGearPreset({ ...state.permanent, gearModes: { ...state.permanent.gearModes, [id]: 'standard' }, gearUnlocked: { ...state.permanent.gearUnlocked, [id]: true } }) };
}
