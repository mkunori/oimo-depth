import { createGearSettings } from '../data/gearModes';
import { createEmptyGear, GEAR_IDS } from '../data/gear';
import type { GearFlags, GearId } from '../data/gear';
import { discoverGear } from './gearProgress';
import { createInitialRootProgress, ROOT_UPGRADE_IDS } from '../data/root';
import type { RootUpgradeRanks } from '../data/root';
import { createEmptyOriginResearch, ORIGIN_RESEARCH_IDS } from '../data/originResearch';
import type { OriginResearchRanks } from '../data/originResearch';
import { GameNumber, gn, encodeGameNumbers } from './numbers';
import { advanceWithAutomation, getProductionPerSecond, getEquipmentPrice } from './game';
import type { GameState } from './state';
import { createEmptyEquipmentCounts, EQUIPMENT_IDS, INITIAL_EQUIPMENT_IDS, isOriginEquipment, isRootEquipment } from '../data/equipment';
import { SKILL_IDS } from '../data/skills';
import { createInitialPermanent } from './state';
import type { PermanentProgress } from './state';
import type { ScoreCapStage } from '../data/scoreCaps';
import { createDefaultAutomation, readAutomation } from '../data/automation';
import type { AutomationSettings } from '../data/automation';
import { createEmptyResearch, RESEARCH_IDS } from '../data/research';
import type { ResearchRanks } from '../data/research';
import { assertPermanentProgress } from './skills';
import { createEmptyDigResearch, DIG_RESEARCH_IDS } from '../data/depth';
import type { DigResearchRanks } from '../data/depth';

export const SAVE_VERSION = 14;
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
  readonly earnedDepth: number;
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
function readGameState(value: unknown, version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 = SAVE_VERSION, internal = false): GameState {
  const state = record(value);
  const counts = record(state.equipmentCounts);
  if (state.imo === undefined || state.runEarnedScore === undefined) {
    throw new SaveDataError('所持芋・SCORE の値が正しくありません。');
  }
  const equipmentCounts = createEmptyEquipmentCounts();
  for (const id of EQUIPMENT_IDS) {
    const isNewId = !(INITIAL_EQUIPMENT_IDS as readonly string[]).includes(id);
    const introduced = isOriginEquipment(id) ? 11 : isRootEquipment(id) ? 9 : id === 'veinExtractor' || id === 'concentrator' ? 6 : isNewId ? 3 : 1;
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
    if (version >= 8 && typeof savedPermanent.deepResearchCount !== 'number') throw new SaveDataError('解析累計が正しくありません。');
    if (version >= 9 && (typeof savedPermanent.rootConnectionUnlocked !== 'boolean'
      || !(version >= 11 ? [0, 1, 2, 3, 4] : [0, 1, 2, 3]).includes(savedPermanent.maxDiscoveredStage as number))) throw new SaveDataError('発見履歴・根脈接続権が正しくありません。');
    permanent = { ...(version < 12 ? createInitialRootProgress() : {
      rootRebirthCount: savedPermanent.rootRebirthCount as number,
      unspentRootCrystals: savedPermanent.unspentRootCrystals as number,
      totalRootCrystalsEarned: savedPermanent.totalRootCrystalsEarned as number,
      totalRootCrystalsSpent: savedPermanent.totalRootCrystalsSpent as number,
      equipmentSystemUnlocked: savedPermanent.equipmentSystemUnlocked as boolean,
      rootUpgradeRanks: (() => { const root = record(savedPermanent.rootUpgradeRanks);
        return Object.fromEntries(ROOT_UPGRADE_IDS.map((id) => [id, root[id]])) as RootUpgradeRanks; })(),
    }),
      ...(version < 14 ? createGearSettings() : { gearModes: structuredClone(savedPermanent.gearModes) as PermanentProgress['gearModes'], gearCustomPresets: structuredClone(savedPermanent.gearCustomPresets) as PermanentProgress['gearCustomPresets'], selectedGearPreset: savedPermanent.selectedGearPreset as PermanentProgress['selectedGearPreset'] }),
      gearUnlocked: version < 13 ? createEmptyGear() : (() => { const gear = record(savedPermanent.gearUnlocked); return Object.fromEntries(GEAR_IDS.map((id) => [id, gear[id]])) as GearFlags; })(),
      gearDiscovered: version < 13 ? createEmptyGear() : (() => { const gear = record(savedPermanent.gearDiscovered); return Object.fromEntries(GEAR_IDS.map((id) => [id, gear[id]])) as GearFlags; })(),
      prestigeCount: savedPermanent.prestigeCount, unspentPoints: savedPermanent.unspentPoints, skillRanks,
      depthMeters: version >= 10 ? savedPermanent.depthMeters as number : 0,
      depthRemainder: version >= 10 ? savedPermanent.depthRemainder as number : 0,
      digResearchRanks: version >= 10 ? (() => {
        const dig = record(savedPermanent.digResearchRanks);
        if (DIG_RESEARCH_IDS.some((id) => typeof dig[id] !== 'number')) throw new SaveDataError('掘削研究が正しくありません。');
        return Object.fromEntries(DIG_RESEARCH_IDS.map((id) => [id, dig[id]])) as DigResearchRanks;
      })() : createEmptyDigResearch(),
      originAnalysisUnlocked: version >= 11 ? savedPermanent.originAnalysisUnlocked as boolean : false,
      rootConnectionUnlocked: version >= 9 ? savedPermanent.rootConnectionUnlocked as boolean : false,
      maxDiscoveredStage: version >= 9 ? savedPermanent.maxDiscoveredStage as ScoreCapStage
        : version >= 6 && savedPermanent.deepResearchUnlocked ? 2 : version >= 4 && state.scoreCapStage === 1 ? 1 : 0,
      deepResearchCount: version >= 8 ? savedPermanent.deepResearchCount as number : version >= 6 && savedPermanent.deepResearchUnlocked ? 1 : 0,
      deepResearchUnlocked: version >= 6 ? savedPermanent.deepResearchUnlocked as boolean : false };
    // Legacy formats could not reset skill prerequisites. Validate their original
    // acquisition rules before granting the new history-based exception.
    if (version < 8) assertPermanentProgress(permanent, false);
  }
  if ((version >= 4 && state.scoreCapStage !== 0 && state.scoreCapStage !== 1 && !(version >= 6 && state.scoreCapStage === 2) && !(version >= 9 && state.scoreCapStage === 3) && !(version >= 11 && state.scoreCapStage === 4))
    || (version < 4 && state.scoreCapStage !== undefined && state.scoreCapStage !== 0)) throw new SaveDataError('SCORE上限段階が正しくありません。');
  let automation: AutomationSettings;
  try {
    if (version < 5) automation = createDefaultAutomation();
    else if (version < 11) {
      const previousIds = EQUIPMENT_IDS.filter((id) => !isOriginEquipment(id) && !(version < 9 && isRootEquipment(id)) && !(version === 5 && (id === 'veinExtractor' || id === 'concentrator')));
      const addedIds = EQUIPMENT_IDS.filter((id) => !previousIds.includes(id));
      const old = record(state.automation);
      const selected = record(old.equipment);
      if (Object.keys(selected).length !== previousIds.length || previousIds.some((id) => typeof selected[id] !== 'boolean')
        || !Array.isArray(old.priority) || old.priority.length !== previousIds.length
        || new Set(old.priority).size !== previousIds.length || old.priority.some((id) => !previousIds.includes(id))) throw new Error();
      automation = readAutomation({ ...old, equipment: { ...selected, ...Object.fromEntries(addedIds.map((id) => [id, true])) },
        priority: [...old.priority, ...addedIds] });
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
      if (typeof value !== 'string') throw new SaveDataError('v7以降の金額は正規化した文字列が必要です。');
      result = gn(value);
      if (result.toString() !== value) throw new SaveDataError('巨大数が正規形ではありません。');
    }
    if (!signed && result.sign < 0) throw new SaveDataError('金額に負の値は使えません。');
    return result;
  };
  let result: GameState = {
    scoreSpentThisRun: version < 13 ? gn(0) : amount(state.scoreSpentThisRun),
    gearPurchasedThisRun: version < 13 ? [] : (() => { if (!Array.isArray(state.gearPurchasedThisRun) || state.gearPurchasedThisRun.length > GEAR_IDS.length) throw new SaveDataError('装備の支出内訳が正しくありません。'); return [...state.gearPurchasedThisRun] as GearId[]; })(),
    postDeepResearchSkillLock: version >= 8 ? state.postDeepResearchSkillLock as boolean : false,
    imo: amount(state.imo), runEarnedScore: amount(state.runEarnedScore), equipmentCounts,
    runStartingImo: version === 1 ? gn(0) : amount(state.runStartingImo),
    scoreCapStage: version < 4 ? 0 : state.scoreCapStage as ScoreCapStage,
    permanent,
    automation,
    originResearchRanks: version < 11 ? createEmptyOriginResearch() : (() => {
      const ranks = record(state.originResearchRanks);
      return Object.fromEntries(ORIGIN_RESEARCH_IDS.map((id) => [id, ranks[id]])) as OriginResearchRanks;
    })(),
    researchRanks: version < 6 ? createEmptyResearch() : (() => {
      const ranks = record(state.researchRanks);
      if (RESEARCH_IDS.some((id) => typeof ranks[id] !== 'number')) throw new SaveDataError('研究ランクが正しくありません。');
      return Object.fromEntries(RESEARCH_IDS.map((id) => [id, ranks[id]])) as ResearchRanks;
    })(),
    productionRemainder: carry ? { score: amount(carry.score, true), imo: amount(carry.imo, true) } : { score: gn(0), imo: gn(0) },
  };
  if (version < 13) result = discoverGear(result);
  try {
    getProductionPerSecond(result);
    for (const id of EQUIPMENT_IDS) {
      const price = getEquipmentPrice(id, equipmentCounts[id], permanent);
      if (version < 7 && !isOriginEquipment(id) && price.gt(Number.MAX_SAFE_INTEGER)) throw new SaveDataError('旧セーブの設備価格が範囲外です。');
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
  if (data.saveVersion !== 1 && data.saveVersion !== 2 && data.saveVersion !== 3 && data.saveVersion !== 4 && data.saveVersion !== 5 && data.saveVersion !== 6 && data.saveVersion !== 7 && data.saveVersion !== 8 && data.saveVersion !== 9 && data.saveVersion !== 10 && data.saveVersion !== 11 && data.saveVersion !== 12 && data.saveVersion !== 13 && data.saveVersion !== SAVE_VERSION) {
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
    earnedDepth: gameState.permanent.depthMeters - valid.gameState.permanent.depthMeters,
  };
  // 時計が戻った場合も保存時刻を巻き戻さず、同じ時間帯の再精算を避ける。
  return { save: createSave(gameState, Math.max(currentTime, valid.savedAt)), report, progress };
}
