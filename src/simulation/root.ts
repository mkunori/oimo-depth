import { performRootRebirth, purchaseRootUpgrade } from '../core/root';
import { performBreakthrough } from '../core/breakthrough';
import { performDeepResearch } from '../core/research';
import { performRootConnection } from '../core/rootConnection';
import { performOriginAnalysis } from '../core/origin';
import { getProductionPerSecond } from '../core/game';
import { createSave, parseSave, serializeSave } from '../core/save';
import type { simulateOrigins } from './origin';
import { investSkills } from './policies';
import { simulateRun } from './simulator';
import type { TracePoint } from './simulator';

/** Reuse actual first ROOT routes; no invented normal points/skills/depth. */
export function simulateRootCycles(origins: ReturnType<typeof simulateOrigins>, maxSeconds: number) {
  return origins.filter((trial) => trial.policy === 'research' && trial.result.completed)
    .flatMap((previous) => (previous.automated && [60, 21600].includes(previous.scenario.visitSeconds!) ? ['blessing', 'memory'] as const : ['blessing'] as const).map((choice) => {
      const afterRoot = performRootRebirth(previous.result.state);
      const purchased = purchaseRootUpgrade(afterRoot, choice);
      // Spend only retained normal points, at the manual ROOT confirmation.
      const initialState = parseSave(serializeSave(createSave(investSkills(purchased, 'breakthrough'), 0))).gameState;
      const scenario = { ...previous.scenario, id: `root-cycle-${previous.scenario.visitSeconds}-${previous.automated ? 'auto' : 'manual'}-${choice}`,
        label: `${previous.scenario.label} / ROOT後 ${choice}`, prestigeAt: 'cap' as const };
      const stages = [], trace: TracePoint[] = [];
      let state = initialState, elapsedSeconds = 0;
      for (let stage = 0; stage <= 4 && elapsedSeconds < maxSeconds; stage += 1) {
        const initial = state;
        const result = simulateRun(state, scenario, maxSeconds - elapsedSeconds);
        stages.push({ stage, startsAtSeconds: elapsedSeconds, initialState: initial, result });
        trace.push(...result.trace.map((point) => ({ ...point, elapsedSeconds: elapsedSeconds + point.elapsedSeconds })));
        elapsedSeconds += result.elapsedSeconds; state = result.state;
        if (!result.completed) break;
        if (stage === 0) state = performBreakthrough(state);
        if (stage === 1) state = performDeepResearch(state);
        if (stage === 2) state = performRootConnection(state);
        if (stage === 3) state = performOriginAnalysis(state);
      }
      const completed = state.scoreCapStage === 4 && state.runEarnedScore.gte(1e18);
      const afterSecondRoot = completed ? performRootRebirth(state) : null;
      return { scenario, automated: previous.automated, choice, firstRootSeconds: previous.totalSeconds,
        firstState: previous.result.state, afterRoot, initialState, stages, trace, state, completed, elapsedSeconds,
        totalSeconds: previous.totalSeconds + elapsedSeconds, afterSecondRoot,
        initialProduction: getProductionPerSecond(initialState), finalProduction: getProductionPerSecond(state) };
    }));
}
