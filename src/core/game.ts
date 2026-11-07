import { getGearModeEffects, gearModeKey } from './gearModeEffects';
import { assertGearProgress, getGearMultiplier } from './gearProgress';
import { getRootBonuses } from './rootProgress';
import { createEmptyOriginResearch, getOriginResearchSpent, ORIGIN_RESEARCH, ORIGIN_RESEARCH_IDS, originMultiplier } from '../data/originResearch';
import type { OriginResearchRanks } from '../data/originResearch';
import { INITIAL_BALANCE } from '../data/balance';
import { EQUIPMENT, EQUIPMENT_IDS, isOriginEquipment, isRootEquipment, ROOT_LINK_PRODUCTION } from '../data/equipment';
import type { EquipmentDefinition, EquipmentId } from '../data/equipment';
import type { GameState, PermanentProgress } from './state';
import { createInitialPermanent } from './state';
import { getSkillBonuses } from './skills';
import { getScoreCap, SCORE_CAP_STAGES } from '../data/scoreCaps';
import { readAutomation } from '../data/automation';
import type { AutomationSettings } from '../data/automation';
import { createEmptyResearch, getResearchSpent, RESEARCH, RESEARCH_IDS, researchMultiplier } from '../data/research';
import type { ResearchRanks } from '../data/research';
import { GameNumber, gn, nonNegativeGameNumber, toElapsedSeconds } from './numbers';
import { SKILLS } from '../data/skills';
import { advanceExcavation, DepthProgressError } from './excavation';

export type PurchaseMode = 1 | 10 | 'MAX';
export interface PurchaseQuote { readonly quantity: number; readonly totalCost: GameNumber }
export const MAX_AUTOMATIC_PURCHASES = 2_048;
export const MAX_BULK_PURCHASES = 50_000;
export class AutomationLimitError extends Error {}
export class NumericProgressError extends AutomationLimitError {}
const priceCache = new Map<string, GameNumber>();
const productionCache = new Map<string, GameNumber>();
const targetCache = new Map<string, EquipmentId | undefined>();

function assertCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Equipment count must be a non-negative safe integer.');
}
function getDefinition(id: EquipmentId): EquipmentDefinition {
  if (!Object.hasOwn(EQUIPMENT, id)) throw new RangeError(`Unknown equipment: ${id}`);
  return EQUIPMENT[id];
}
export function assertGameState(state: GameState) {
  const cap = getScoreCap(state);
  for (const value of [state.imo, state.runEarnedScore, state.runStartingImo]) {
    if (!(value instanceof GameNumber)) throw new RangeError('Game amounts must be GameNumber.');
    nonNegativeGameNumber(value);
  }
  const bonuses = getSkillBonuses(state.permanent);
  assertGearProgress(state);
  if (!state.researchRanks || RESEARCH_IDS.some((id) => !Number.isSafeInteger(state.researchRanks[id])
    || state.researchRanks[id] < 0 || state.researchRanks[id] > RESEARCH[id].costs.length)
    || (state.scoreCapStage < 2 && RESEARCH_IDS.some((id) => state.researchRanks[id] !== 0))
    || (state.scoreCapStage >= 2 && !state.permanent.deepResearchUnlocked)) throw new RangeError('Invalid research progress.');
  if (!state.originResearchRanks || ORIGIN_RESEARCH_IDS.some((id) => !Number.isSafeInteger(state.originResearchRanks[id])
    || state.originResearchRanks[id] < 0 || state.originResearchRanks[id] > ORIGIN_RESEARCH[id].costs.length
    || (state.scoreCapStage < 4 && state.originResearchRanks[id] !== 0))) throw new RangeError('Invalid origin research.');
  if (state.scoreCapStage === 4 && !state.permanent.originAnalysisUnlocked) throw new RangeError('Origin permission required.');
  if (state.permanent.maxDiscoveredStage < state.scoreCapStage
    || (state.scoreCapStage >= 3 && !state.permanent.rootConnectionUnlocked)) throw new RangeError('Invalid discovery or root connection.');
  readAutomation(state.automation);
  if (state.automation.enabled && state.permanent.skillRanks.automation === 0) throw new RangeError('Automation skill is required.');
  const carry = state.productionRemainder;
  if (carry !== undefined) {
    if (carry === null || typeof carry !== 'object') throw new RangeError('Invalid production remainder.');
    const bound = cap.max(1).multiply(32 * Number.EPSILON);
    for (const value of [carry.score, carry.imo]) {
      if (!(value instanceof GameNumber) || value.abs().gt(bound)) throw new RangeError('Invalid production remainder.');
    }
    if (state.runEarnedScore.subtract(carry.score).lt(0) || state.runEarnedScore.subtract(carry.score).gt(cap)) throw new RangeError('Compensated SCORE exceeds the run range.');
  }
  if (state.scoreCapStage >= 2 && state.permanent.deepResearchCount <= state.permanent.rootRebirthCount) throw new RangeError('Current ROOT cycle requires a new deep analysis.');
  const locked = state.postDeepResearchSkillLock;
  const ranks = state.permanent.skillRanks;
  const count = state.permanent.deepResearchCount;
  if (typeof locked !== 'boolean' || (state.scoreCapStage >= 2 && count >= 2 && count < 4 && !locked)
    || (locked && (state.scoreCapStage < 2 || count < 1 || count >= 4
    || (count === 1 && (ranks.harvest > 0 || ranks.discount > 0 || ranks.startingImo > 0))
    || (count === 2 && (ranks.discount > 0 || ranks.startingImo > 0))
    || (count === 3 && ranks.discount > 0 && ranks.startingImo > 0)))) throw new RangeError('Invalid post-research skill lock.');
  // The starting grant records an actual payment. A reset cannot undo it; only this
  // locked run may retain a grant above the current normal-skill bonus
  // (max rank 2 × 50), in addition to the persistent ROOT starting grant.
  const grantStep = SKILLS.startingImo.effect.perRank;
  const grantLimit = locked ? gn(SKILLS.startingImo.maxRank * grantStep).add(getRootBonuses(state.permanent).startingImo) : bonuses.startingImo;
  if (!state.runStartingImo.floor().equals(state.runStartingImo) || state.runStartingImo.gt(grantLimit)
    || (locked && !state.runStartingImo.divide(grantStep).floor().equals(state.runStartingImo.divide(grantStep)))
    || state.imo.gt(state.runEarnedScore.add(state.runStartingImo)) || state.runEarnedScore.gt(cap)
    || state.imo.add(getResearchSpent(state.researchRanks)).add(getOriginResearchSpent(state.originResearchRanks)).gt(state.runEarnedScore.add(state.runStartingImo).add(0.001))
    || state.permanent.skillRanks.breakthrough < SCORE_CAP_STAGES[state.scoreCapStage].requiredSkillRank
    || (state.scoreCapStage > 0 && state.runEarnedScore.lt(SCORE_CAP_STAGES[state.scoreCapStage - 1]!.cap))) throw new RangeError('Invalid run balance or SCORE.');
  for (const id of EQUIPMENT_IDS) {
    assertCount(state.equipmentCounts[id]);
    if (!getEquipmentAvailability(id, state).unlocked && state.equipmentCounts[id] !== 0) throw new RangeError('Locked equipment cannot be owned.');
  }
  return bonuses;
}
export function getProductionPerSecond(state: GameState): GameNumber {
  const bonuses = assertGameState(state);
  const root = getRootBonuses(state.permanent);
  const modes = getGearModeEffects(state.permanent, state.researchRanks.geology);
  const key = `${gearModeKey(state.permanent)}:${EQUIPMENT_IDS.map((id) => state.equipmentCounts[id]).join(',')}:${bonuses.productionMultiplier}:${root.lateAndDig}:${getGearMultiplier(state.permanent)}:${state.researchRanks.geology}:${state.researchRanks.resonance}:${state.originResearchRanks.harvest}:${state.originResearchRanks.link}`;
  const cached = productionCache.get(key);
  if (cached) return cached;
  const value = EQUIPMENT_IDS.reduce((sum, id) => sum.add(getDefinition(id).productionPerUnit.multiply(state.equipmentCounts[id])
    .multiply(getEquipmentMilestones(id, state.equipmentCounts[id]).multiplier)
    .multiply(researchMultiplier(state.researchRanks, id === 'veinExtractor' || id === 'concentrator'))
    .multiply(getDefinition(id).unlockAtScoreCap.gte(1e12) ? root.lateAndDig : 1).multiply(modes.equipment[id])),
  INITIAL_BALANCE.baseProduction.multiply(researchMultiplier(state.researchRanks)))
    .add(getRootLink(state.equipmentCounts).baseProduction.multiply(researchMultiplier(state.researchRanks))
      .multiply(ORIGIN_RESEARCH.link.multiplier ** state.originResearchRanks.link).multiply(modes.link))
    .multiply(originMultiplier(state.originResearchRanks))
    .multiply(bonuses.productionMultiplier).multiply(getGearMultiplier(state.permanent)).multiply(modes.global);
  if (productionCache.size < 4_096) productionCache.set(key, value);
  return value;
}
export function getEquipmentProductionPerUnit(id: EquipmentId, permanent: PermanentProgress = createInitialPermanent(), ownedCount = 0, research: ResearchRanks = createEmptyResearch(), origin: OriginResearchRanks = createEmptyOriginResearch()): GameNumber {
  const modes = getGearModeEffects(permanent, research.geology);
  return getDefinition(id).productionPerUnit.multiply(getSkillBonuses(permanent).productionMultiplier).multiply(modes.equipment[id]).multiply(modes.global)
    .multiply(getEquipmentMilestones(id, ownedCount).multiplier)
    .multiply(researchMultiplier(research, id === 'veinExtractor' || id === 'concentrator')).multiply(originMultiplier(origin)).multiply(getDefinition(id).unlockAtScoreCap.gte(1e12) ? getRootBonuses(permanent).lateAndDig : 1).multiply(getGearMultiplier(permanent));
}
export function getEquipmentMilestones(id: EquipmentId, ownedCount: number) {
  assertCount(ownedCount);
  const milestones = getDefinition(id).milestones;
  const achieved = milestones.filter((milestone) => ownedCount >= milestone.count);
  const multiplier = achieved.reduce((value, milestone) => value * milestone.multiplier, 1);
  const next = milestones.find((milestone) => ownedCount < milestone.count) ?? null;
  return { achieved, multiplier, next, nextMultiplier: next ? multiplier * next.multiplier : null };
}
export function getRootLink(counts: GameState['equipmentCounts']) {
  const relays = counts.rootRelay, chambers = counts.coreChamber;
  assertCount(relays); assertCount(chambers);
  const linked = Math.min(Math.floor(relays / 2), chambers);
  const unconnectedRelays = relays - linked * 2, unconnectedChambers = chambers - linked;
  return { linked, unconnectedRelays, unconnectedChambers,
    nextRelays: Math.max(0, 2 - unconnectedRelays), nextChambers: Math.max(0, 1 - unconnectedChambers),
    baseProduction: ROOT_LINK_PRODUCTION.multiply(linked) };
}
/** Difference of total production before/after purchase, including production in
 * other equipment. Subtract components first to avoid cancelling a small gain
 * against a much larger unchanged total. */
export function getEquipmentPurchaseGain(id: EquipmentId, state: Pick<GameState, 'equipmentCounts' | 'permanent' | 'researchRanks' | 'originResearchRanks'>): GameNumber {
  const { equipmentCounts: before, permanent, researchRanks: research, originResearchRanks: origin } = state;
  const after = { ...before, [id]: before[id] + 1 };
  assertCount(after[id]);
  let gain = gn(0);
  for (const equipment of EQUIPMENT_IDS) {
    if (before[equipment] === after[equipment]) continue;
    gain = gain.add(getEquipmentProductionPerUnit(equipment, permanent, after[equipment], research, origin).multiply(after[equipment])
      .subtract(getEquipmentProductionPerUnit(equipment, permanent, before[equipment], research, origin).multiply(before[equipment])));
  }
  const linkGain = getRootLink(after).baseProduction.subtract(getRootLink(before).baseProduction);
  const modes = getGearModeEffects(permanent, research.geology);
  return gain.add(linkGain.multiply(modes.link).multiply(modes.global).multiply(originMultiplier(origin, true)).multiply(researchMultiplier(research)).multiply(getSkillBonuses(permanent).productionMultiplier).multiply(getGearMultiplier(permanent)));
}
export function isEquipmentDiscovered(id: EquipmentId, state: Pick<GameState, 'permanent'>): boolean {
  return isOriginEquipment(id) ? state.permanent.maxDiscoveredStage >= 4 : !isRootEquipment(id) || state.permanent.maxDiscoveredStage >= 3;
}
export function getEquipmentAvailability(id: EquipmentId, state: Pick<GameState, 'scoreCapStage'> = { scoreCapStage: 0 }) {
  const requiredScoreCap = getDefinition(id).unlockAtScoreCap;
  return { unlocked: getScoreCap(state).gte(requiredScoreCap), requiredScoreCap };
}
export function getEquipmentPrice(id: EquipmentId, ownedCount: number, permanent: PermanentProgress = createInitialPermanent()): GameNumber {
  assertCount(ownedCount);
  assertCount(ownedCount + 1);
  const definition = getDefinition(id);
  const discount = getSkillBonuses(permanent).equipmentPriceMultiplier;
  const key = `${id}:${ownedCount}:${discount}`;
  const cached = priceCache.get(key);
  if (cached) return cached;
  const value = definition.basePrice.multiply(definition.priceMultiplier.pow(ownedCount)).multiply(discount).ceil();
  if (priceCache.size < 8_192) priceCache.set(key, value);
  return value;
}

function compensatedAdd(value: GameNumber, debt: GameNumber, increment: GameNumber) {
  const adjusted = increment.subtract(debt);
  const next = value.add(adjusted);
  return { value: next, debt: next.subtract(value).subtract(adjusted) };
}
function advanceProduction(state: GameState, seconds: number, rate: GameNumber): GameState {
  if (seconds === 0 || state.runEarnedScore.gte(getScoreCap(state))) return state;
  const cap = getScoreCap(state);
  const debt = state.productionRemainder ?? { score: gn(0), imo: gn(0) };
  const remaining = cap.subtract(state.runEarnedScore).add(debt.score).max(0);
  const income = rate.multiply(seconds).min(remaining);
  const capped = income.gte(remaining);
  const score = compensatedAdd(state.runEarnedScore, debt.score, income);
  const balance = compensatedAdd(state.imo, debt.imo, income);
  const runEarnedScore = capped ? cap : score.value.min(cap);
  const imo = balance.value.max(0).min(runEarnedScore.add(state.runStartingImo));
  const productionRemainder = { score: capped ? gn(0) : score.debt, imo: balance.debt.add(imo.subtract(balance.value)) };
  const activeSeconds = capped ? (getAmountSeconds(remaining, rate, seconds) ?? seconds) : seconds;
  let permanent;
  try { permanent = advanceExcavation(state, activeSeconds); }
  catch (error) {
    if (error instanceof DepthProgressError) throw new NumericProgressError(error.message);
    throw error;
  }
  // Tiny additions remain bounded debt until they become representable; they never grant affordability credit.
  return { ...state, runEarnedScore, imo, productionRemainder, permanent };
}

/** Pure budget quote also supports future prices beyond the current SCORE cap. */
export function quoteEquipmentPurchase(id: EquipmentId, owned: number, budget: GameNumber, permanent: PermanentProgress, limit = MAX_BULK_PURCHASES): PurchaseQuote {
  assertCount(owned); nonNegativeGameNumber(budget);
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_BULK_PURCHASES) throw new RangeError('Invalid bulk purchase limit.');
  let totalCost = gn(0), quantity = 0;
  while (quantity < limit) {
    const cost = totalCost.add(getEquipmentPrice(id, owned + quantity, permanent));
    const order = cost.compare(budget);
    if (order > 0) break;
    if (!Number.isSafeInteger(owned + quantity + 2)) throw new NumericProgressError('Ownership would leave no safe next count.');
    if (cost.equals(totalCost)) throw new NumericProgressError('Purchase cost does not advance at the supported precision.');
    totalCost = cost; quantity += 1;
  }
  if (quantity === MAX_BULK_PURCHASES && getEquipmentPrice(id, owned + quantity, permanent).lte(budget.subtract(totalCost))) throw new NumericProgressError('Bulk purchase processing limit reached.');
  return { quantity, totalCost };
}
export function getPurchaseQuote(state: GameState, id: EquipmentId, mode: PurchaseMode): PurchaseQuote {
  assertGameState(state); getDefinition(id);
  if (mode !== 1 && mode !== 10 && mode !== 'MAX') throw new RangeError('Invalid purchase mode.');
  if (state.runEarnedScore.gte(getScoreCap(state)) || !getEquipmentAvailability(id, state).unlocked) return { quantity: 0, totalCost: gn(0) };
  const result = quoteEquipmentPurchase(id, state.equipmentCounts[id], state.imo, state.permanent, mode === 'MAX' ? MAX_BULK_PURCHASES : mode);
  if (mode === 'MAX' && result.quantity === MAX_BULK_PURCHASES) throw new NumericProgressError('Bulk purchase processing limit reached.');
  return result;
}
export function getAffordableQuantity(state: GameState, id: EquipmentId): number { return getPurchaseQuote(state, id, 'MAX').quantity; }
export function purchaseEquipment(state: GameState, id: EquipmentId, mode: PurchaseMode): GameState {
  const { quantity, totalCost } = getPurchaseQuote(state, id, mode);
  return quantity === 0 ? state : { ...state, imo: state.imo.subtract(totalCost), equipmentCounts: { ...state.equipmentCounts, [id]: state.equipmentCounts[id] + quantity } };
}
export interface AutomaticProgress {
  readonly state: GameState;
  readonly purchased: Readonly<Record<EquipmentId, number>>;
  readonly purchaseCount: number;
  readonly capAtSeconds: number | null;
  readonly events: readonly { readonly seconds: number; readonly id: EquipmentId; readonly state: GameState }[];
}
function nextAutomaticEquipment(state: GameState): EquipmentId | undefined {
  const settings = state.automation;
  const key = settings.policy === 'priority' ? '' : `${gearModeKey(state.permanent)}:${getGearMultiplier(state.permanent)}:${state.scoreCapStage}:${settings.policy}:${EQUIPMENT_IDS.map((id) => `${state.equipmentCounts[id]}:${Number(settings.equipment[id])}`).join(',')}:${state.permanent.skillRanks.harvest}:${state.permanent.skillRanks.discount}:${state.permanent.rootRebirthCount}:${state.permanent.rootUpgradeRanks.blessing}:${state.permanent.rootUpgradeRanks.memory}:${state.permanent.rootUpgradeRanks.adaptation}:${state.researchRanks.geology}:${state.researchRanks.resonance}:${state.originResearchRanks.harvest}:${state.originResearchRanks.link}`;
  if (settings.policy !== 'priority' && targetCache.has(key)) return targetCache.get(key);
  const ids = EQUIPMENT_IDS.filter((id) => settings.equipment[id] && getEquipmentAvailability(id, state).unlocked);
  const price = (id: EquipmentId) => getEquipmentPrice(id, state.equipmentCounts[id], state.permanent);
  if (settings.policy !== 'priority') {
    const id = settings.policy === 'balanced' ? ids.sort((a, b) => state.equipmentCounts[a] - state.equipmentCounts[b])[0]
      : ids.sort((a, b) => price(a).divide(getEquipmentPurchaseGain(a, state))
        .compare(price(b).divide(getEquipmentPurchaseGain(b, state))))[0];
    if (targetCache.size < 4_096) targetCache.set(key, id);
    return id;
  }
  const ordered = settings.priority.filter((id) => ids.includes(id));
  return ordered.find((id) => price(id).lte(state.imo)) ?? ordered.sort((a, b) => price(a).compare(price(b)))[0];
}
/** Only finite, bounded duration conversions leave the amount layer. */
export function getAmountSeconds(amount: GameNumber, rate: GameNumber, horizon = Number.MAX_VALUE): number | null {
  const result = toElapsedSeconds(amount.max(0), rate, horizon);
  if (result.kind === 'below-resolution') throw new NumericProgressError('Positive event time is below the supported resolution.');
  return result.kind === 'within-horizon' ? result.seconds : null;
}
export function getNextAutomaticPurchaseSeconds(state: GameState): number | null {
  const rate = getProductionPerSecond(state);
  if (!state.automation.enabled || state.runEarnedScore.gte(getScoreCap(state))) return null;
  const id = nextAutomaticEquipment(state);
  if (id === undefined) return null;
  const gap = getEquipmentPrice(id, state.equipmentCounts[id], state.permanent).subtract(state.imo).max(0);
  return gap.isZero() ? 0 : getAmountSeconds(gap.add(state.productionRemainder?.imo.max(0) ?? 0), rate);
}
export function advanceWithAutomation(initial: GameState, elapsedSeconds: number, trace = false): AutomaticProgress {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw new RangeError('Elapsed seconds must be finite and non-negative.');
  let rate = getProductionPerSecond(initial);
  let state = initial, remainingSeconds = elapsedSeconds, elapsed = 0, purchaseCount = 0;
  const purchased = Object.fromEntries(EQUIPMENT_IDS.map((id) => [id, 0])) as Record<EquipmentId, number>;
  const events: { seconds: number; id: EquipmentId; state: GameState }[] = [];
  const result = (capAtSeconds: number | null): AutomaticProgress => ({ state, purchased, purchaseCount, capAtSeconds, events });
  for (let step = 0; step < MAX_AUTOMATIC_PURCHASES * 8; step += 1) {
    if (state.runEarnedScore.gte(getScoreCap(state))) return result(elapsed);
    const capGap = getScoreCap(state).subtract(state.runEarnedScore).add(state.productionRemainder?.score ?? 0).max(0);
    const id = state.automation.enabled ? nextAutomaticEquipment(state) : undefined;
    if (id === undefined) {
      state = advanceProduction(state, remainingSeconds, rate);
      return result(state.runEarnedScore.gte(getScoreCap(state)) ? elapsed + (getAmountSeconds(capGap, rate, remainingSeconds) ?? remainingSeconds) : null);
    }
    const price = getEquipmentPrice(id, state.equipmentCounts[id], state.permanent);
    const canBuy = price.lte(state.imo);
    if (canBuy) {
      if (purchaseCount >= MAX_AUTOMATIC_PURCHASES) throw new AutomationLimitError('Automatic purchase limit reached.');
      const next = purchaseEquipment(state, id, 1);
      if (next === state) throw new NumericProgressError('Automatic purchase made no progress.');
      state = next; purchased[id] += 1; purchaseCount += 1;
      rate = getProductionPerSecond(state);
      if (trace) events.push({ seconds: elapsed, id, state });
      continue;
    }
    if (remainingSeconds === 0) return result(null);
    const gap = price.subtract(state.imo).max(0).add(state.productionRemainder?.imo.max(0) ?? 0);
    const incomeBudget = rate.multiply(remainingSeconds);
    if (gap.gt(incomeBudget) && capGap.gt(incomeBudget)) {
      state = advanceProduction(state, remainingSeconds, rate);
      elapsed += remainingSeconds;
      remainingSeconds = 0;
      // Compensation can land exactly on the represented price at the final instant.
      // Always recheck the actual balance; do not infer eligibility from the pre-addition estimate.
      if (state.runEarnedScore.gte(getScoreCap(state))) return result(elapsed);
      if (state.imo.gte(price)) continue;
      return result(null);
    }
    const toCap = getAmountSeconds(capGap, rate, remainingSeconds);
    const toPurchase = getAmountSeconds(gap, rate, remainingSeconds);
    const delta = Math.min(toCap ?? remainingSeconds, toPurchase ?? remainingSeconds, remainingSeconds);
    if (delta <= 0) throw new NumericProgressError('Positive event requires a representable time step.');
    const next = advanceProduction(state, delta, rate);
    remainingSeconds = Math.max(0, remainingSeconds - delta); elapsed += delta;
    if (next.runEarnedScore.equals(state.runEarnedScore) && next.imo.equals(state.imo)
      && next.productionRemainder?.score.equals(state.productionRemainder?.score ?? 0)
      && next.productionRemainder?.imo.equals(state.productionRemainder?.imo ?? 0)) throw new NumericProgressError('Production made no representable progress.');
    state = next;
  }
  throw new AutomationLimitError('Automatic event limit reached.');
}
export function advanceGame(state: GameState, elapsedSeconds: number): GameState { return advanceWithAutomation(state, elapsedSeconds).state; }
export function configureAutomation(state: GameState, settings: AutomationSettings): GameState {
  getProductionPerSecond(state);
  const automation = readAutomation(settings);
  return state.permanent.skillRanks.automation === 0 ? state : { ...state, automation };
}
