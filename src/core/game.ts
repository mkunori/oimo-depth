import { INITIAL_BALANCE } from '../data/balance';
import { EQUIPMENT, EQUIPMENT_IDS } from '../data/equipment';
import type { EquipmentDefinition, EquipmentId } from '../data/equipment';
import type { GameState } from './state';
import { createInitialPermanent } from './state';
import type { PermanentProgress } from './state';
import { getSkillBonuses } from './skills';
import { getScoreCap, SCORE_CAP_STAGES } from '../data/scoreCaps';

export type PurchaseMode = 1 | 10 | 'MAX';

export interface PurchaseQuote {
  readonly quantity: number;
  readonly totalCost: number;
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number.`);
  }
}

function assertCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Equipment count must be a non-negative safe integer.');
  }
}

function getDefinition(id: EquipmentId): EquipmentDefinition {
  if (!Object.hasOwn(EQUIPMENT, id)) {
    throw new RangeError(`Unknown equipment: ${id}`);
  }
  return EQUIPMENT[id];
}

function assertState(state: GameState): void {
  const scoreCap = getScoreCap(state);
  assertNonNegativeFinite(state.imo, 'imo');
  assertNonNegativeFinite(state.runEarnedScore, 'runEarnedScore');
  const bonuses = getSkillBonuses(state.permanent);
  assertNonNegativeFinite(state.runStartingImo, 'runStartingImo');
  if (!Number.isSafeInteger(state.runStartingImo) || state.runStartingImo > bonuses.startingImo
    || state.imo > state.runEarnedScore + state.runStartingImo
    || state.runEarnedScore > scoreCap
    || state.permanent.skillRanks.breakthrough < SCORE_CAP_STAGES[state.scoreCapStage].requiredSkillRank
    || (state.scoreCapStage > 0 && state.runEarnedScore < SCORE_CAP_STAGES[state.scoreCapStage - 1]!.cap)) {
    throw new RangeError('Invalid run balance, starting grant, or SCORE.');
  }
  for (const id of EQUIPMENT_IDS) {
    assertCount(state.equipmentCounts[id]);
    if (!getEquipmentAvailability(id, state).unlocked && state.equipmentCounts[id] !== 0) {
      throw new RangeError('Locked equipment cannot be owned in this cap stage.');
    }
  }
}

/** 単位時間の生産能力。上限到達後も能力自体は変わらず、収穫だけが止まる。 */
export function getProductionPerSecond(state: GameState): number {
  assertState(state);
  const production = EQUIPMENT_IDS.reduce<number>(
    (total, id) => total + state.equipmentCounts[id] * EQUIPMENT[id].productionPerUnit * getEquipmentMilestones(id, state.equipmentCounts[id]).multiplier,
    INITIAL_BALANCE.baseProduction,
  ) * getSkillBonuses(state.permanent).productionMultiplier;
  assertNonNegativeFinite(production, 'production');
  return production;
}

/** 1台あたりの加算生産量。倍率を含めてUIへ返す。 */
export function getEquipmentProductionPerUnit(id: EquipmentId, permanent: PermanentProgress = createInitialPermanent(), ownedCount = 0): number {
  return getDefinition(id).productionPerUnit * getSkillBonuses(permanent).productionMultiplier * getEquipmentMilestones(id, ownedCount).multiplier;
}

/** その設備の全所有台数へ、達成済みの倍率を乗算して適用する。基礎生産は対象外。 */
export function getEquipmentMilestones(id: EquipmentId, ownedCount: number) {
  assertCount(ownedCount);
  const milestones = getDefinition(id).milestones;
  const achieved = milestones.filter((milestone) => ownedCount >= milestone.count);
  const multiplier = achieved.reduce((value, milestone) => value * milestone.multiplier, 1);
  const next = milestones.find((milestone) => ownedCount < milestone.count) ?? null;
  return { achieved, multiplier, next, nextMultiplier: next ? multiplier * next.multiplier : null };
}

/** 次の1台により既存台数へ乗るボーナスも含めた、生産量の増分。 */
export function getEquipmentPurchaseGain(id: EquipmentId, ownedCount: number, permanent: PermanentProgress): number {
  assertCount(ownedCount + 1);
  return (ownedCount + 1) * getEquipmentProductionPerUnit(id, permanent, ownedCount + 1)
    - ownedCount * getEquipmentProductionPerUnit(id, permanent, ownedCount);
}

export function getEquipmentAvailability(id: EquipmentId, state: Pick<GameState, 'scoreCapStage'> = { scoreCapStage: 0 }) {
  const requiredScoreCap = getDefinition(id).unlockAtScoreCap;
  return { unlocked: getScoreCap(state) >= requiredScoreCap, requiredScoreCap };
}

/** 割引適用後に1台ずつ切り上げる。恒久データ省略時はボーナスなしの価格。 */
export function getEquipmentPrice(id: EquipmentId, ownedCount: number, permanent: PermanentProgress = createInitialPermanent()): number {
  assertCount(ownedCount);
  const definition = getDefinition(id);
  const price = Math.ceil(definition.basePrice * definition.priceMultiplier ** ownedCount * getSkillBonuses(permanent).equipmentPriceMultiplier);
  if (!Number.isSafeInteger(price) || price <= 0) {
    throw new RangeError('Equipment price exceeds the supported number range.');
  }
  return price;
}

/** 実時間には触れず、経過秒数から収穫を計算する。入力は変更しない。 */
export function advanceGame(state: GameState, elapsedSeconds: number): GameState {
  assertNonNegativeFinite(elapsedSeconds, 'elapsedSeconds');
  const production = getProductionPerSecond(state);
  const remaining = getScoreCap(state) - state.runEarnedScore;
  if (elapsedSeconds === 0 || remaining === 0) {
    return state;
  }

  // 大きな有限時間でも production * elapsedSeconds を先に計算して溢れさせない。
  const earned = elapsedSeconds >= remaining / production
    ? remaining
    : production * elapsedSeconds;
  const runEarnedScore = Math.min(getScoreCap(state), state.runEarnedScore + earned);
  const actualEarned = runEarnedScore - state.runEarnedScore;

  return {
    ...state,
    imo: Math.min(runEarnedScore + state.runStartingImo, state.imo + actualEarned),
    runEarnedScore,
  };
}

/** 指定モードの上限まで、現在の残高で実際に買える数量と支出を返す。 */
export function getPurchaseQuote(
  state: GameState,
  id: EquipmentId,
  mode: PurchaseMode,
): PurchaseQuote {
  assertState(state);
  getDefinition(id);
  if (mode !== 1 && mode !== 10 && mode !== 'MAX') {
    throw new RangeError('Purchase mode must be 1, 10, or MAX.');
  }
  if (state.runEarnedScore >= getScoreCap(state) || !getEquipmentAvailability(id, state).unlocked) return { quantity: 0, totalCost: 0 };

  const limit = mode === 'MAX' ? Number.MAX_SAFE_INTEGER : mode;
  let quantity = 0;
  let totalCost = 0;
  while (quantity < limit) {
    const ownedCount = state.equipmentCounts[id] + quantity;
    const price = getEquipmentPrice(id, ownedCount, state.permanent);
    if (price > state.imo - totalCost) {
      break;
    }
    // 次の所有数も安全な整数であることを購入前に保証する。
    assertCount(ownedCount + 1);
    totalCost += price;
    quantity += 1;
  }
  return { quantity, totalCost };
}

export function getAffordableQuantity(state: GameState, id: EquipmentId): number {
  return getPurchaseQuote(state, id, 'MAX').quantity;
}

export function purchaseEquipment(
  state: GameState,
  id: EquipmentId,
  mode: PurchaseMode,
): GameState {
  const { quantity, totalCost } = getPurchaseQuote(state, id, mode);
  if (quantity === 0) {
    return state;
  }
  return {
    ...state,
    imo: state.imo - totalCost,
    equipmentCounts: {
      ...state.equipmentCounts,
      [id]: state.equipmentCounts[id] + quantity,
    },
  };
}
