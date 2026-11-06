import { INITIAL_BALANCE } from '../data/balance';
import { EQUIPMENT, EQUIPMENT_IDS } from '../data/equipment';
import type { EquipmentDefinition, EquipmentId } from '../data/equipment';
import type { GameState } from './state';
import { createInitialPermanent } from './state';
import type { PermanentProgress } from './state';
import { getSkillBonuses } from './skills';
import { getScoreCap, SCORE_CAP_STAGES } from '../data/scoreCaps';
import { readAutomation } from '../data/automation';
import type { AutomationSettings } from '../data/automation';

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
  readAutomation(state.automation);
  if (state.automation.enabled && state.permanent.skillRanks.automation === 0) throw new RangeError('Automation skill is required.');
  assertNonNegativeFinite(state.runStartingImo, 'runStartingImo');
  if (state.automationRemainder !== undefined) {
    const tolerance = 32 * Number.EPSILON * Math.max(1, scoreCap, state.runEarnedScore, state.imo);
    if (typeof state.automationRemainder !== 'object' || state.automationRemainder === null
      || !Number.isFinite(state.automationRemainder.score) || !Number.isFinite(state.automationRemainder.imo)
      || Math.abs(state.automationRemainder.score) > tolerance || Math.abs(state.automationRemainder.imo) > tolerance) throw new RangeError('Invalid automation remainder.');
  }
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
function advanceProduction(state: GameState, elapsedSeconds: number): GameState {
  assertNonNegativeFinite(elapsedSeconds, 'elapsedSeconds');
  const production = getProductionPerSecond(state);
  const remaining = getScoreCap(state) - state.runEarnedScore;
  if (elapsedSeconds === 0 || remaining === 0) {
    return state;
  }

  if (state.automation.enabled || state.automationRemainder !== undefined) {
    // Kahan補償加算: 250ms更新を何十万回繰り返しても、毎回捨てた端数を次回に戻す。
    const carry = state.automationRemainder ?? { score: 0, imo: 0 };
    const fullRemaining = remaining + carry.score;
    const capped = elapsedSeconds >= fullRemaining / production;
    const earned = capped ? fullRemaining : production * elapsedSeconds;
    const score = compensatedAdd(state.runEarnedScore, carry.score, earned);
    const imo = compensatedAdd(state.imo, carry.imo, earned);
    const runEarnedScore = capped ? getScoreCap(state) : Math.min(getScoreCap(state), score.value);
    return { ...state, runEarnedScore, imo: Math.max(0, Math.min(runEarnedScore + state.runStartingImo, imo.value)),
      automationRemainder: { score: capped ? 0 : score.remainder, imo: imo.remainder } };
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

function compensatedAdd(value: number, remainder: number, increment: number) {
  const adjusted = increment - remainder;
  const next = value + adjusted;
  return { value: next, remainder: (next - value) - adjusted };
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

export const MAX_AUTOMATIC_PURCHASES = 1_024;
export class AutomationLimitError extends Error {}

export interface AutomaticProgress {
  readonly state: GameState;
  readonly purchased: Readonly<Record<EquipmentId, number>>;
  readonly purchaseCount: number;
  readonly capAtSeconds: number | null;
  readonly events: readonly { readonly seconds: number; readonly id: EquipmentId; readonly state: GameState }[];
}

/** 方針は残高の小分け観測に依存させない。指定優先だけは即時フォールバックする。 */
function nextAutomaticEquipment(state: GameState): EquipmentId | undefined {
  const settings = state.automation;
  const ids = EQUIPMENT_IDS.filter((id) => settings.equipment[id] && getEquipmentAvailability(id, state).unlocked);
  if (settings.policy === 'balanced') return ids.sort((a, b) => state.equipmentCounts[a] - state.equipmentCounts[b])[0];
  const price = (id: EquipmentId) => getEquipmentPrice(id, state.equipmentCounts[id], state.permanent);
  if (settings.policy === 'efficient') return ids.sort((a, b) => price(a) / getEquipmentPurchaseGain(a, state.equipmentCounts[a], state.permanent)
    - price(b) / getEquipmentPurchaseGain(b, state.equipmentCounts[b], state.permanent))[0];
  const ordered = settings.priority.filter((id) => ids.includes(id));
  return ordered.find((id) => price(id) <= state.imo) ?? ordered.sort((a, b) => price(a) - price(b))[0];
}

/** 常時操作シミュレーターが価格式や購入方針を複製せず次の境界を確認する。 */
export function getNextAutomaticPurchaseSeconds(state: GameState): number | null {
  const rate = getProductionPerSecond(state);
  if (!state.automation.enabled || state.runEarnedScore >= getScoreCap(state)) return null;
  const id = nextAutomaticEquipment(state);
  return id === undefined ? null : Math.max(0, (getEquipmentPrice(id, state.equipmentCounts[id], state.permanent) - state.imo) / rate);
}

/** 購入イベント駆動。上限到達を購入より先に処理し、残り時間を捏造しない。 */
export function advanceWithAutomation(initial: GameState, elapsedSeconds: number, trace = false): AutomaticProgress {
  assertNonNegativeFinite(elapsedSeconds, 'elapsedSeconds');
  getProductionPerSecond(initial);
  let state = initial;
  let remainingSeconds = elapsedSeconds;
  let elapsed = 0;
  let purchaseCount = 0;
  const purchased = Object.fromEntries(EQUIPMENT_IDS.map((id) => [id, 0])) as Record<EquipmentId, number>;
  const events: { seconds: number; id: EquipmentId; state: GameState }[] = [];
  const result = (capAtSeconds: number | null): AutomaticProgress => ({ state, purchased, purchaseCount, capAtSeconds, events });
  while (true) {
    if (state.runEarnedScore >= getScoreCap(state)) return result(elapsed);
    const rate = getProductionPerSecond(state);
    const toCap = (getScoreCap(state) - state.runEarnedScore) / rate;
    const id = state.automation.enabled ? nextAutomaticEquipment(state) : undefined;
    if (id === undefined) {
      state = advanceProduction(state, remainingSeconds);
      return result(toCap <= remainingSeconds ? elapsed + toCap : null);
    }
    const price = getEquipmentPrice(id, state.equipmentCounts[id], state.permanent);
    const gap = price - state.imo;
    const tolerance = 8 * Number.EPSILON * Math.max(1, state.runEarnedScore, price);
    if (gap > 0 && gap <= tolerance && gap < getScoreCap(state) - state.runEarnedScore) {
      // 表現精度内の価格境界を正規化。差分を持ち越し、次の収穫から相殺する。
      const score = Math.max(state.runEarnedScore, price - state.runStartingImo);
      state = { ...state, imo: price, runEarnedScore: score, automationRemainder: {
        score: (state.automationRemainder?.score ?? 0) + (score - state.runEarnedScore),
        imo: (state.automationRemainder?.imo ?? 0) + gap } };
      if (state.runEarnedScore >= getScoreCap(state)) return result(elapsed);
    }
    if (price <= state.imo) {
      if (purchaseCount >= MAX_AUTOMATIC_PURCHASES) throw new AutomationLimitError('Automatic purchase limit reached.');
      state = purchaseEquipment(state, id, 1);
      purchased[id] += 1;
      purchaseCount += 1;
      if (trace) events.push({ seconds: elapsed, id, state });
      continue;
    }
    if (remainingSeconds === 0) return result(null);
    // SCORE差分の桁落ちで価格直前に止まらない、最大数ULP相当の時間余裕。
    const roundingSeconds = 8 * Number.EPSILON * Math.max(1, state.runEarnedScore, price) / rate;
    const toPurchase = (price - state.imo) / rate + roundingSeconds;
    const delta = Math.min(toCap, toPurchase, remainingSeconds);
    state = advanceProduction(state, delta);
    remainingSeconds = Math.max(0, remainingSeconds - delta);
    elapsed += delta;
    if (delta === toCap) return result(elapsed);
  }
}

export function advanceGame(state: GameState, elapsedSeconds: number): GameState {
  return advanceWithAutomation(state, elapsedSeconds).state;
}

export function configureAutomation(state: GameState, settings: AutomationSettings): GameState {
  getProductionPerSecond(state);
  const automation = readAutomation(settings);
  if (state.permanent.skillRanks.automation === 0) return state;
  return { ...state, automation };
}
