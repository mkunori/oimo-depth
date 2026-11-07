import { EQUIPMENT, EQUIPMENT_IDS } from '../data/equipment';
import { DEPTH_BALANCE, DIG_RESEARCH, DIG_RESEARCH_IDS, STRATA } from '../data/depth';
import type { PermanentProgress, GameState } from './state';

export class DepthProgressError extends RangeError {}
export function getStratum(depth: number): number {
  let index = 0;
  while (index + 1 < STRATA.length && depth >= STRATA[index + 1]!.start) index += 1;
  return index;
}
export function assertExcavation(permanent: PermanentProgress): void {
  const { depthMeters: depth, depthRemainder: carry, digResearchRanks: ranks } = permanent;
  if (!Number.isFinite(depth) || depth < 0 || depth > DEPTH_BALANCE.maxMeters
    || !Number.isFinite(carry) || Math.abs(carry) > 32 * Number.EPSILON * Math.max(1, depth)
    || depth - carry < 0 || depth - carry > DEPTH_BALANCE.maxMeters
    || !ranks || DIG_RESEARCH_IDS.some((id) => !Number.isSafeInteger(ranks[id]) || ranks[id] < 0
      || ranks[id] > DIG_RESEARCH[id].costs.length || (ranks[id] > 0 && depth < DIG_RESEARCH[id].unlockDepth))) throw new DepthProgressError('Invalid excavation progress.');
}
export function getDigPower(state: Pick<GameState, 'permanent' | 'equipmentCounts'>): number {
  const { permanent, equipmentCounts: counts } = state;
  const base = EQUIPMENT_IDS.reduce<number>((sum, id) => sum + counts[id] * EQUIPMENT[id].digPowerPerUnit, DEPTH_BALANCE.baseDigPower);
  const linked = Math.min(Math.floor(counts.rootRelay / 2), counts.coreChamber);
  const bonus = permanent.depthMeters >= 10000 ? 1 + linked * DEPTH_BALANCE.linkBonusPerPair : 1;
  const result = base * 2 ** (permanent.digResearchRanks.basic + permanent.digResearchRanks.vein) * bonus;
  if (!Number.isFinite(result) || result <= 0) throw new DepthProgressError('Dig power must be positive and finite.');
  return result;
}
export function getDigSpeed(state: Pick<GameState, 'permanent' | 'equipmentCounts'>): number {
  return getDigPower(state) / STRATA[getStratum(state.permanent.depthMeters)]!.hardness;
}

/** Purchase/SCORE events bound a constant-equipment interval. Within it, process
 * the earliest stratum boundary and remaining time (at most five crossings).
 * Money is added once by the caller, so excavation does not perturb its rounding. */
export function advanceExcavation(state: GameState, seconds: number): PermanentProgress {
  if (seconds === 0) return state.permanent;
  let permanent = state.permanent, remaining = seconds;
  for (let step = 0; step < STRATA.length; step += 1) {
    const index = getStratum(permanent.depthMeters);
    const speed = getDigSpeed({ permanent, equipmentCounts: state.equipmentCounts });
    const boundary = STRATA[index + 1]?.start;
    const toBoundary = boundary === undefined ? Infinity : (boundary - permanent.depthMeters + permanent.depthRemainder) / speed;
    if (toBoundary <= remaining && boundary !== undefined) {
      if (toBoundary < 0) throw new DepthProgressError('Stratum event moved backwards.');
      remaining = Math.max(0, remaining - toBoundary);
      permanent = { ...permanent, depthMeters: boundary, depthRemainder: 0 };
      if (remaining === 0) return permanent;
      continue;
    }
    const adjusted = speed * remaining - permanent.depthRemainder;
    const depth = permanent.depthMeters + adjusted;
    if (!Number.isFinite(depth) || depth > DEPTH_BALANCE.maxMeters) throw new DepthProgressError('DEPTH exceeds the supported range.');
    if (boundary !== undefined && depth >= boundary) return { ...permanent, depthMeters: boundary, depthRemainder: 0 };
    return { ...permanent, depthMeters: Math.max(permanent.depthMeters, depth),
      depthRemainder: (Math.max(permanent.depthMeters, depth) - permanent.depthMeters) - adjusted };
  }
  throw new DepthProgressError('Stratum event limit reached.');
}
