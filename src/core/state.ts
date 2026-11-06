import type { EquipmentId } from '../data/equipment';
import type { SkillId } from '../data/skills';

/** 転生で引き継ぐデータ。将来の恒久データはこの境界に追加する。 */
export interface PermanentProgress {
  readonly prestigeCount: number;
  readonly unspentPoints: number;
  readonly skillRanks: Readonly<Record<SkillId, number>>;
}

export function createInitialPermanent(): PermanentProgress {
  return { prestigeCount: 0, unspentPoints: 0, skillRanks: { harvest: 0, discount: 0, startingImo: 0 } };
}

/** 転生時に初期化するデータ。初期所持芋は収穫累計とは別に管理する。 */
export interface RunState {
  /** 設備購入で消費する芋の残高。 */
  readonly imo: number;
  /** 現周回の累計獲得量。購入では減らさず、収穫上限の判定に使う。 */
  readonly runEarnedScore: number;
  readonly runStartingImo: number;
  readonly equipmentCounts: Readonly<Record<EquipmentId, number>>;
}

export interface GameState extends RunState {
  readonly permanent: PermanentProgress;
}

export function createInitialState(): GameState {
  return {
    imo: 0,
    runEarnedScore: 0,
    runStartingImo: 0,
    equipmentCounts: { worker: 0, cart: 0, harvester: 0 },
    permanent: createInitialPermanent(),
  };
}
