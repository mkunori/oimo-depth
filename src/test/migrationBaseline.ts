import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { GameNumber, approximatelyEqual } from '../core/numbers';
import type { GameState } from '../core/state';
import type { EquipmentId } from '../data/equipment';
import type { SkillId } from '../data/skills';
import { getScoreCap } from '../data/scoreCaps';
import type { SimulationSuite } from '../simulation/suite';

type Path = readonly string[];
interface Baseline {
  equipmentIds: readonly EquipmentId[];
  skillIds: readonly SkillId[];
  states: readonly [Path, number[], number, number[], number, number, number[], number, number, number][];
  counters: readonly [Path, number][];
  times: readonly [Path, number][];
  amounts: readonly [Path, number][];
}
const baseline: Baseline = JSON.parse(readFileSync(new URL('./fixtures/balance-v6.json', import.meta.url), 'utf8'));
function at(root: unknown, path: Path): unknown {
  let value = root;
  for (const key of path) {
    if (value === null || typeof value !== 'object') throw new Error(`Missing baseline path: ${path.join('.')}`);
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Fixed pre-migration evidence. #37 intentionally changes research routes only;
 * retain the original fixture and continue checking every unaffected route. */
export function assertV6BalanceBaseline(suite: SimulationSuite): void {
  for (const [path, counts, capStage, ranks, prestigeCount, points, research, imo, score, starting] of baseline.states) {
    if (path[0] === 'research') continue;
    const state = at(suite, path) as GameState;
    const label = path.join('.');
    expect(baseline.equipmentIds.map((id) => state.equipmentCounts[id]), label).toEqual(counts);
    expect(state.scoreCapStage, label).toBe(capStage);
    expect(baseline.skillIds.map((id) => state.permanent.skillRanks[id]), label).toEqual(ranks);
    expect(state.permanent.prestigeCount, label).toBe(prestigeCount);
    expect(state.permanent.unspentPoints, label).toBe(points);
    expect([state.researchRanks.geology, state.researchRanks.resonance], label).toEqual(research);
    for (const [value, previous] of [[state.imo, imo], [state.runEarnedScore, score], [state.runStartingImo, starting]] as const) {
      expect(value instanceof GameNumber, label).toBe(true);
      expect(approximatelyEqual(value, previous, 1e-8, 1e-11), label).toBe(true);
    }
    if (score === [1e6, 1e9, 1e12][capStage]) expect(state.runEarnedScore.equals(getScoreCap(state)), label).toBe(true);
  }
  for (const [path, expected] of baseline.counters) if (path[0] !== 'research') expect(at(suite, path), path.join('.')).toBe(expected);
  for (const [path, expected] of baseline.times) if (path[0] !== 'research') expect(Math.abs((at(suite, path) as number) - expected), path.join('.')).toBeLessThanOrEqual(Math.max(1e-6, Math.abs(expected) * 1e-11));
  for (const [path, expected] of baseline.amounts) if (path[0] !== 'research') expect(approximatelyEqual(at(suite, path) as GameNumber, expected, 1e-8, 1e-11), path.join('.')).toBe(true);
}
