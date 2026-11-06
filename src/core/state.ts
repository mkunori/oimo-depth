import type { EquipmentId } from '../data/equipment';
import { createEmptyEquipmentCounts } from '../data/equipment';
import type { SkillId } from '../data/skills';
import type { ScoreCapStage } from '../data/scoreCaps';
import { createDefaultAutomation } from '../data/automation';
import type { AutomationSettings } from '../data/automation';

/** 転生で引き継ぐデータ。将来の恒久データはこの境界に追加する。 */
export interface PermanentProgress {
  readonly prestigeCount: number;
  readonly unspentPoints: number;
  readonly skillRanks: Readonly<Record<SkillId, number>>;
}

export function createInitialPermanent(): PermanentProgress {
  return { prestigeCount: 0, unspentPoints: 0, skillRanks: { harvest: 0, discount: 0, startingImo: 0, breakthrough: 0, automation: 0 } };
}

/** 転生時に初期化するデータ。初期所持芋は収穫累計とは別に管理する。 */
export interface RunState {
  /** 設備購入で消費する芋の残高。 */
  readonly imo: number;
  /** 現周回の累計獲得量。購入では減らさず、収穫上限の判定に使う。 */
  readonly runEarnedScore: number;
  readonly runStartingImo: number;
  readonly scoreCapStage: ScoreCapStage;
  readonly equipmentCounts: Readonly<Record<EquipmentId, number>>;
}

export interface GameState extends RunState {
  readonly permanent: PermanentProgress;
  readonly automation: AutomationSettings;
  /** 自動精算の補償加算端数。設定ではなく周回の計算状態で、転生時に消える。 */
  readonly automationRemainder?: { readonly score: number; readonly imo: number };
}

export function createInitialState(): GameState {
  return {
    imo: 0,
    runEarnedScore: 0,
    runStartingImo: 0,
    scoreCapStage: 0,
    equipmentCounts: createEmptyEquipmentCounts(),
    permanent: createInitialPermanent(),
    automation: createDefaultAutomation(),
  };
}
