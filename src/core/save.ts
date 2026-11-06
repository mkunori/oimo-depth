import { advanceWithAutomation, getProductionPerSecond, getEquipmentPrice } from './game';
import type { GameState } from './state';
import { createEmptyEquipmentCounts, EQUIPMENT_IDS, INITIAL_EQUIPMENT_IDS } from '../data/equipment';
import { SKILL_IDS } from '../data/skills';
import { createInitialPermanent } from './state';
import type { PermanentProgress } from './state';
import type { ScoreCapStage } from '../data/scoreCaps';
import { createDefaultAutomation, readAutomation } from '../data/automation';
import type { AutomationSettings } from '../data/automation';
import { createEmptyResearch, RESEARCH_IDS } from '../data/research';
import type { ResearchRanks } from '../data/research';

export const SAVE_VERSION = 6;
export const OFFLINE_LIMIT_SECONDS = 24 * 60 * 60;

export interface SaveData {
  readonly saveVersion: typeof SAVE_VERSION;
  readonly savedAt: number;
  readonly gameState: GameState;
}

export interface OfflineReport {
  readonly elapsedSeconds: number;
  readonly appliedSeconds: number;
  readonly earnedImo: number;
  readonly reachedScore: number;
  readonly clockReversed: boolean;
  readonly automaticPurchases: number;
}

export class SaveDataError extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SaveDataError('セーブの形式が正しくありません。');
  }
  return value as Record<string, unknown>;
}

function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) {
    throw new SaveDataError('保存時刻が正しくありません。');
  }
  return value;
}

/** 外部データから既知の項目だけをコピーし、コアと画面で扱える数値か検証する。 */
function readGameState(value: unknown, version: 1 | 2 | 3 | 4 | 5 | 6 = SAVE_VERSION): GameState {
  const state = record(value);
  const counts = record(state.equipmentCounts);
  if (typeof state.imo !== 'number' || typeof state.runEarnedScore !== 'number') {
    throw new SaveDataError('所持芋・SCORE の値が正しくありません。');
  }
  const equipmentCounts = createEmptyEquipmentCounts();
  for (const id of EQUIPMENT_IDS) {
    const isNewId = !(INITIAL_EQUIPMENT_IDS as readonly string[]).includes(id);
    const introduced = id === 'veinExtractor' || id === 'concentrator' ? 6 : isNewId ? 3 : 1;
    const count = version < introduced && counts[id] === undefined ? 0 : counts[id];
    if (version < introduced && count !== 0) throw new SaveDataError('旧形式に未対応の設備があります。');
    if (typeof count !== 'number') {
      throw new SaveDataError('設備の所有数が正しくありません。');
    }
    equipmentCounts[id] = count;
  }
  let permanent: PermanentProgress = createInitialPermanent();
  if (version >= 2) {
    const savedPermanent = record(state.permanent);
    const ranks = record(savedPermanent.skillRanks);
    const skillRanks = { ...createInitialPermanent().skillRanks };
    for (const id of SKILL_IDS) {
      const introduced = id === 'automation' ? 5 : id === 'breakthrough' ? 4 : 2;
      const rank = version < introduced && ranks[id] === undefined ? 0 : ranks[id];
      if (typeof rank !== 'number' || (version < introduced && rank !== 0)) throw new SaveDataError('スキルのランクが正しくありません。');
      skillRanks[id] = rank;
    }
    if (typeof savedPermanent.prestigeCount !== 'number' || typeof savedPermanent.unspentPoints !== 'number'
      || typeof state.runStartingImo !== 'number') throw new SaveDataError('恒久データが正しくありません。');
    if (version >= 6 && typeof savedPermanent.deepResearchUnlocked !== 'boolean') throw new SaveDataError('研究権限が正しくありません。');
    permanent = { prestigeCount: savedPermanent.prestigeCount, unspentPoints: savedPermanent.unspentPoints, skillRanks,
      deepResearchUnlocked: version >= 6 ? savedPermanent.deepResearchUnlocked as boolean : false };
  }
  if ((version >= 4 && state.scoreCapStage !== 0 && state.scoreCapStage !== 1 && !(version >= 6 && state.scoreCapStage === 2))
    || (version < 4 && state.scoreCapStage !== undefined && state.scoreCapStage !== 0)) throw new SaveDataError('SCORE上限段階が正しくありません。');
  let automation: AutomationSettings;
  try {
    if (version < 5) automation = createDefaultAutomation();
    else if (version === 5) {
      const previousIds = EQUIPMENT_IDS.filter((id) => id !== 'veinExtractor' && id !== 'concentrator');
      const old = record(state.automation);
      const selected = record(old.equipment);
      if (Object.keys(selected).length !== previousIds.length || previousIds.some((id) => typeof selected[id] !== 'boolean')
        || !Array.isArray(old.priority) || old.priority.length !== previousIds.length
        || new Set(old.priority).size !== previousIds.length || old.priority.some((id) => !previousIds.includes(id))) throw new Error();
      automation = readAutomation({ ...old, equipment: { ...selected, veinExtractor: true, concentrator: true },
        priority: [...old.priority, 'veinExtractor', 'concentrator'] });
    } else automation = readAutomation(state.automation);
  }
  catch { throw new SaveDataError('自動購入設定が正しくありません。'); }
  const carry = version >= 5 && state.automationRemainder !== undefined ? record(state.automationRemainder) : null;
  if (carry && (typeof carry.score !== 'number' || typeof carry.imo !== 'number')) throw new SaveDataError('自動購入の計算端数が正しくありません。');
  const result: GameState = {
    imo: state.imo, runEarnedScore: state.runEarnedScore, equipmentCounts,
    runStartingImo: version === 1 ? 0 : state.runStartingImo as number,
    scoreCapStage: version < 4 ? 0 : state.scoreCapStage as ScoreCapStage,
    permanent,
    automation,
    researchRanks: version < 6 ? createEmptyResearch() : (() => {
      const ranks = record(state.researchRanks);
      if (RESEARCH_IDS.some((id) => typeof ranks[id] !== 'number')) throw new SaveDataError('研究ランクが正しくありません。');
      return Object.fromEntries(RESEARCH_IDS.map((id) => [id, ranks[id]])) as ResearchRanks;
    })(),
    ...(carry ? { automationRemainder: { score: carry.score as number, imo: carry.imo as number } } : {}),
  };
  try {
    getProductionPerSecond(result);
    for (const id of EQUIPMENT_IDS) getEquipmentPrice(id, equipmentCounts[id], permanent);
  } catch {
    throw new SaveDataError('セーブの数値が範囲外です。');
  }
  return result;
}

export function createSave(gameState: GameState, savedAt: number): SaveData {
  return { saveVersion: SAVE_VERSION, savedAt: timestamp(savedAt), gameState: readGameState(gameState) };
}

export function parseSave(text: string): SaveData {
  let data: Record<string, unknown>;
  try {
    data = record(JSON.parse(text));
  } catch {
    throw new SaveDataError('セーブを読み込めません。JSON 形式のテキストを確認してください。');
  }
  if (data.saveVersion !== 1 && data.saveVersion !== 2 && data.saveVersion !== 3 && data.saveVersion !== 4 && data.saveVersion !== 5 && data.saveVersion !== SAVE_VERSION) {
    throw new SaveDataError('未対応のセーブバージョンです。元のテキストを保管してください。');
  }
  return createSave(readGameState(data.gameState, data.saveVersion), timestamp(data.savedAt));
}

export function serializeSave(save: SaveData): string {
  if (save.saveVersion !== SAVE_VERSION) throw new SaveDataError('未対応のセーブバージョンです。');
  return JSON.stringify(createSave(save.gameState, save.savedAt));
}

/** 時計と保存領域に依存しない、決定的なオフライン精算。 */
export function settleOffline(save: SaveData, now: number, traceAutomation = false) {
  const valid = createSave(save.gameState, save.savedAt);
  const currentTime = timestamp(now);
  const elapsedSeconds = Math.max(0, (currentTime - valid.savedAt) / 1_000);
  const appliedSeconds = Math.min(elapsedSeconds, OFFLINE_LIMIT_SECONDS);
  // 経過0では新たな購入をせず、同じ復帰時刻の二重精算も防ぐ。
  const progress = appliedSeconds > 0 ? advanceWithAutomation(valid.gameState, appliedSeconds, traceAutomation) : null;
  const gameState = progress?.state ?? valid.gameState;
  const report: OfflineReport = {
    elapsedSeconds,
    appliedSeconds,
    earnedImo: gameState.runEarnedScore - valid.gameState.runEarnedScore,
    reachedScore: gameState.runEarnedScore,
    clockReversed: currentTime < valid.savedAt,
    automaticPurchases: progress?.purchaseCount ?? 0,
  };
  // 時計が戻った場合も保存時刻を巻き戻さず、同じ時間帯の再精算を避ける。
  return { save: createSave(gameState, Math.max(currentTime, valid.savedAt)), report, progress };
}
