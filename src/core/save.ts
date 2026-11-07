import { GameNumber, gn, encodeGameNumbers } from './numbers';
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

export const SAVE_VERSION = 7;
export const OFFLINE_LIMIT_SECONDS = 24 * 60 * 60;

export interface SaveData {
  readonly saveVersion: typeof SAVE_VERSION;
  readonly savedAt: number;
  readonly gameState: GameState;
}

export interface OfflineReport {
  readonly elapsedSeconds: number;
  readonly appliedSeconds: number;
  readonly earnedImo: GameNumber;
  readonly reachedScore: GameNumber;
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
function readGameState(value: unknown, version: 1 | 2 | 3 | 4 | 5 | 6 | 7 = SAVE_VERSION, internal = false): GameState {
  const state = record(value);
  const counts = record(state.equipmentCounts);
  if (state.imo === undefined || state.runEarnedScore === undefined) {
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
      || state.runStartingImo === undefined) throw new SaveDataError('恒久データが正しくありません。');
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
  const carryValue = version >= 7 ? state.productionRemainder : version >= 5 ? state.automationRemainder : undefined;
  const carry = carryValue === undefined ? null : record(carryValue);
  const amount = (value: unknown, signed = false): GameNumber => {
    let result;
    if (internal) {
      if (!(value instanceof GameNumber)) throw new SaveDataError('内部の金額形式が正しくありません。');
      result = value;
    } else if (version < 7) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new SaveDataError('旧セーブの金額が範囲外です。');
      result = gn(value);
    } else {
      if (typeof value !== 'string') throw new SaveDataError('v7の金額は正規化した文字列が必要です。');
      result = gn(value);
      if (result.toString() !== value) throw new SaveDataError('巨大数が正規形ではありません。');
    }
    if (!signed && result.sign < 0) throw new SaveDataError('金額に負の値は使えません。');
    return result;
  };
  const result: GameState = {
    imo: amount(state.imo), runEarnedScore: amount(state.runEarnedScore), equipmentCounts,
    runStartingImo: version === 1 ? gn(0) : amount(state.runStartingImo),
    scoreCapStage: version < 4 ? 0 : state.scoreCapStage as ScoreCapStage,
    permanent,
    automation,
    researchRanks: version < 6 ? createEmptyResearch() : (() => {
      const ranks = record(state.researchRanks);
      if (RESEARCH_IDS.some((id) => typeof ranks[id] !== 'number')) throw new SaveDataError('研究ランクが正しくありません。');
      return Object.fromEntries(RESEARCH_IDS.map((id) => [id, ranks[id]])) as ResearchRanks;
    })(),
    productionRemainder: carry ? { score: amount(carry.score, true), imo: amount(carry.imo, true) } : { score: gn(0), imo: gn(0) },
  };
  try {
    getProductionPerSecond(result);
    for (const id of EQUIPMENT_IDS) {
      const price = getEquipmentPrice(id, equipmentCounts[id], permanent);
      if (version < 7 && price.gt(Number.MAX_SAFE_INTEGER)) throw new SaveDataError('旧セーブの設備価格が範囲外です。');
    }
  } catch {
    throw new SaveDataError('セーブの数値が範囲外です。');
  }
  return result;
}

export function createSave(gameState: GameState, savedAt: number): SaveData {
  return { saveVersion: SAVE_VERSION, savedAt: timestamp(savedAt), gameState: readGameState(gameState, SAVE_VERSION, true) };
}

export function parseSave(text: string): SaveData {
  let data: Record<string, unknown>;
  try {
    data = record(JSON.parse(text));
  } catch {
    throw new SaveDataError('セーブを読み込めません。JSON 形式のテキストを確認してください。');
  }
  if (data.saveVersion !== 1 && data.saveVersion !== 2 && data.saveVersion !== 3 && data.saveVersion !== 4 && data.saveVersion !== 5 && data.saveVersion !== 6 && data.saveVersion !== SAVE_VERSION) {
    throw new SaveDataError('未対応のセーブバージョンです。元のテキストを保管してください。');
  }
  try { return createSave(readGameState(data.gameState, data.saveVersion), timestamp(data.savedAt)); }
  catch (error) {
    if (error instanceof SaveDataError) throw error;
    throw new SaveDataError('巨大数の形式または範囲が正しくありません。元のテキストを保管してください。');
  }
}

export function serializeSave(save: SaveData): string {
  if (save.saveVersion !== SAVE_VERSION) throw new SaveDataError('未対応のセーブバージョンです。');
  return JSON.stringify(encodeGameNumbers(createSave(save.gameState, save.savedAt)));
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
    earnedImo: gameState.runEarnedScore.subtract(valid.gameState.runEarnedScore),
    reachedScore: gameState.runEarnedScore,
    clockReversed: currentTime < valid.savedAt,
    automaticPurchases: progress?.purchaseCount ?? 0,
  };
  // 時計が戻った場合も保存時刻を巻き戻さず、同じ時間帯の再精算を避ける。
  return { save: createSave(gameState, Math.max(currentTime, valid.savedAt)), report, progress };
}
