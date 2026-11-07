import type { EquipmentId } from '../data/equipment';
import { createEmptyEquipmentCounts } from '../data/equipment';
import type { SkillId } from '../data/skills';
import type { ScoreCapStage } from '../data/scoreCaps';
import { createDefaultAutomation } from '../data/automation';
import type { AutomationSettings } from '../data/automation';
import { createEmptyResearch } from '../data/research';
import type { ResearchRanks } from '../data/research';
import { GameNumber, gn } from './numbers';
import { createEmptyDigResearch } from '../data/depth';
import type { DigResearchRanks } from '../data/depth';

/** 転生で引き継ぐデータ。将来の恒久データはこの境界に追加する。 */
export interface PermanentProgress {
  readonly depthMeters: number;
  readonly depthRemainder: number;
  readonly digResearchRanks: DigResearchRanks;
  readonly rootConnectionUnlocked: boolean;
  readonly maxDiscoveredStage: ScoreCapStage;
  readonly deepResearchCount: number;
  readonly deepResearchUnlocked: boolean;
  readonly prestigeCount: number;
  readonly unspentPoints: number;
  readonly skillRanks: Readonly<Record<SkillId, number>>;
}

export function createInitialPermanent(): PermanentProgress {
  return { depthMeters: 0, depthRemainder: 0, digResearchRanks: createEmptyDigResearch(), rootConnectionUnlocked: false, maxDiscoveredStage: 0, deepResearchCount: 0, deepResearchUnlocked: false, prestigeCount: 0, unspentPoints: 0, skillRanks: { harvest: 0, discount: 0, startingImo: 0, breakthrough: 0, automation: 0 } };
}

/** 転生時に初期化するデータ。初期所持芋は収穫累計とは別に管理する。 */
export interface RunState {
  readonly postDeepResearchSkillLock: boolean;
  readonly researchRanks: ResearchRanks;
  /** 設備購入で消費する芋の残高。 */
  readonly imo: GameNumber;
  /** 現周回の累計獲得量。購入では減らさず、収穫上限の判定に使う。 */
  readonly runEarnedScore: GameNumber;
  readonly runStartingImo: GameNumber;
  readonly scoreCapStage: ScoreCapStage;
  readonly equipmentCounts: Readonly<Record<EquipmentId, number>>;
}

export interface GameState extends RunState {
  readonly permanent: PermanentProgress;
  readonly automation: AutomationSettings;
  /** 全収穫の補償加算端数。設定ではなく周回の計算状態で、転生時にゼロへ戻る。 */
  readonly productionRemainder?: { readonly score: GameNumber; readonly imo: GameNumber };
}

export function createInitialState(): GameState {
  return {
    postDeepResearchSkillLock: false,
    imo: gn(0),
    runEarnedScore: gn(0),
    runStartingImo: gn(0),
    scoreCapStage: 0,
    researchRanks: createEmptyResearch(),
    equipmentCounts: createEmptyEquipmentCounts(),
    permanent: createInitialPermanent(),
    automation: createDefaultAutomation(),
    productionRemainder: { score: gn(0), imo: gn(0) },
  };
}
