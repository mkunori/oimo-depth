import type { EquipmentId } from '../data/equipment';

export interface GameState {
  /** 設備購入で消費する芋の残高。 */
  readonly imo: number;
  /** 現周回の累計獲得量。購入では減らさず、収穫上限の判定に使う。 */
  readonly runEarnedScore: number;
  readonly equipmentCounts: Readonly<Record<EquipmentId, number>>;
}

export function createInitialState(): GameState {
  return {
    imo: 0,
    runEarnedScore: 0,
    equipmentCounts: { worker: 0, cart: 0, harvester: 0 },
  };
}
