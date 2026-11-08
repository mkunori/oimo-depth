import { getPrestigeReward, prestigeGame } from '../core/prestige';
import { getProductionPerSecond } from '../core/game';
import { getScoreCap } from '../data/scoreCaps';
import { getDigPower, getDigSpeed } from '../core/excavation';
import type { GameState } from '../core/state';
import { investSkills } from './policies';
import { simulateRun } from './simulator';
import type { RunResult, Scenario, TracePoint } from './simulator';

/** Actual normal prestiges and paid prerequisites, followed by a final capped
 * stage0 run. No carried points/skills or invented unlocks after ROOT. */
export function simulateRootRebuild(initial: GameState, scenario: Scenario, maxSeconds: number): RunResult {
  let state = initial, elapsed = 0, last: RunResult | undefined, first: RunResult | undefined;
  const trace: TracePoint[] = [];
  const totals = { creditedSeconds: 0, discardedOfflineSeconds: 0, idleAtCapSeconds: 0, purchases: 0, purchaseDecisions: 0, automaticPurchases: 0 };
  for (let run = 0; run < 100 && elapsed < maxSeconds; run += 1) {
    last = simulateRun(state, { ...scenario, prestigeAt: 'cap' }, maxSeconds - elapsed);
    first ??= last;
    trace.push(...last.trace.map((point) => ({ ...point, elapsedSeconds: point.elapsedSeconds + elapsed })));
    elapsed += last.elapsedSeconds;
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += last[key];
    state = last.state;
    if (!last.completed || state.permanent.skillRanks.breakthrough > 0) break;
    const reward = getPrestigeReward(state);
    if (reward === 0) break;
    state = investSkills(prestigeGame(state), 'breakthrough', scenario.automation);
    const production = getProductionPerSecond(state);
    trace.push({ ...last.trace.at(-1)!, kind: 'prestige', elapsedSeconds: elapsed, score: state.runEarnedScore,
      imo: state.imo, production, actualProduction: production, scoreCap: getScoreCap(state),
      prestigeCount: state.permanent.prestigeCount, equipmentCounts: state.equipmentCounts, researchRanks: state.researchRanks,
      digPower: getDigPower(state), digSpeed: getDigSpeed(state),
      scoreSpentThisRun: state.scoreSpentThisRun, spendableScore: state.runEarnedScore, gearUnlocked: state.permanent.gearUnlocked });
  }
  return { ...last!, ...totals, elapsedSeconds: elapsed, lastObservationSeconds: elapsed, state, trace,
    score100k: first?.score100k ?? null, score1m: first?.score1m ?? null,
    completed: !!last?.completed && state.permanent.skillRanks.breakthrough > 0 && state.runEarnedScore.gte(1e6) };
}
