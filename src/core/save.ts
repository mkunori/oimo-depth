import { advanceGame, getEquipmentPrice } from './game';
import type { GameState } from './state';
import { EQUIPMENT_IDS } from '../data/equipment';

export const SAVE_VERSION = 1;
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
function readGameState(value: unknown): GameState {
  const state = record(value);
  const counts = record(state.equipmentCounts);
  if (typeof state.imo !== 'number' || typeof state.runEarnedScore !== 'number') {
    throw new SaveDataError('所持芋・SCORE の値が正しくありません。');
  }
  const equipmentCounts = { worker: 0, cart: 0, harvester: 0 };
  for (const id of EQUIPMENT_IDS) {
    const count = counts[id];
    if (typeof count !== 'number') {
      throw new SaveDataError('設備の所有数が正しくありません。');
    }
    equipmentCounts[id] = count;
  }
  const result: GameState = { imo: state.imo, runEarnedScore: state.runEarnedScore, equipmentCounts };
  try {
    advanceGame(result, 0);
    for (const id of EQUIPMENT_IDS) getEquipmentPrice(id, equipmentCounts[id]);
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
  // マイグレーション追加時は、旧バージョンをここで変換してから値を検証する。
  if (data.saveVersion !== SAVE_VERSION) {
    throw new SaveDataError('未対応のセーブバージョンです。元のテキストを保管してください。');
  }
  return createSave(readGameState(data.gameState), timestamp(data.savedAt));
}

export function serializeSave(save: SaveData): string {
  if (save.saveVersion !== SAVE_VERSION) throw new SaveDataError('未対応のセーブバージョンです。');
  return JSON.stringify(createSave(save.gameState, save.savedAt));
}

/** 時計と保存領域に依存しない、決定的なオフライン精算。 */
export function settleOffline(save: SaveData, now: number) {
  const valid = createSave(save.gameState, save.savedAt);
  const currentTime = timestamp(now);
  const elapsedSeconds = Math.max(0, (currentTime - valid.savedAt) / 1_000);
  const appliedSeconds = Math.min(elapsedSeconds, OFFLINE_LIMIT_SECONDS);
  const gameState = advanceGame(valid.gameState, appliedSeconds);
  const report: OfflineReport = {
    elapsedSeconds,
    appliedSeconds,
    earnedImo: gameState.runEarnedScore - valid.gameState.runEarnedScore,
    reachedScore: gameState.runEarnedScore,
    clockReversed: currentTime < valid.savedAt,
  };
  // 時計が戻った場合も保存時刻を巻き戻さず、同じ時間帯の再精算を避ける。
  return { save: createSave(gameState, Math.max(currentTime, valid.savedAt)), report };
}
