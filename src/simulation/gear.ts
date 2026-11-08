import { simulateRootRebuild } from './rootRebuild';
import type { BuiltinGearPreset } from '../data/gearModes';
import { performRootRebirth, purchaseRootUpgrade } from '../core/root';
import { performBreakthrough } from '../core/breakthrough';
import { performDeepResearch } from '../core/research';
import { performRootConnection } from '../core/rootConnection';
import { performOriginAnalysis } from '../core/origin';
import { getProductionPerSecond } from '../core/game';
import { createSave, parseSave, serializeSave } from '../core/save';
import { GEAR_IDS } from '../data/gear';
import { getGearMultiplier } from '../core/gearProgress';
import type { simulateOrigins } from './origin';
import { investSkills } from './policies';
import { simulateRun } from './simulator';
import type { TracePoint } from './simulator';

/** Three representative schedules, plus one late-purchase control. ROOT
 * crystals after the first choice are held to isolate the gear contribution. */
export function simulateGear(origins: ReturnType<typeof simulateOrigins>, maxSeconds: number, preset?: BuiltinGearPreset) {
  const sources = origins.filter((trial) => trial.policy === 'research' && trial.result.completed
    && (trial.automated && [60, 21600].includes(trial.scenario.visitSeconds!) || !trial.automated && trial.scenario.visitSeconds === 43200));
  return sources.flatMap((previous) => (!preset && previous.automated && previous.scenario.visitSeconds === 60 ? ['early', 'cap'] as const : ['early'] as const).map((policy) => {
    const scenario = { ...previous.scenario, id: `gear-${previous.scenario.visitSeconds}-${previous.automated ? 'auto' : 'manual'}-${policy}${preset ? `-${preset}` : ''}`,
      label: `${previous.scenario.label} / 装備${policy === 'early' ? '随時解禁' : '各上限で解禁'}`, gear: policy, ...(preset ? { gearModePreset: preset } : {}) };
    let state = purchaseRootUpgrade(performRootRebirth(previous.result.state), 'blessing'), elapsedSeconds = 0;
    const cycles = [], trace: TracePoint[] = [];
    for (let cycle = 1; cycle <= 3 && elapsedSeconds < maxSeconds; cycle += 1) {
      state = parseSave(serializeSave(createSave(investSkills(state, 'breakthrough'), 0))).gameState;
      const initialState = state, startsAtSeconds = elapsedSeconds, stages = [];
      for (let stage = 0; stage <= 4 && elapsedSeconds < maxSeconds; stage += 1) {
        const result = stage === 0 ? simulateRootRebuild(state, scenario, maxSeconds - elapsedSeconds)
          : simulateRun(state, scenario, maxSeconds - elapsedSeconds);
        stages.push({ stage, startsAtSeconds: elapsedSeconds, result });
        trace.push(...result.trace.map((point) => ({ ...point, elapsedSeconds: elapsedSeconds + point.elapsedSeconds, run: cycle })));
        state = result.state; elapsedSeconds += result.elapsedSeconds;
        if (!result.completed) break;
        if (stage === 0) state = performBreakthrough(state);
        if (stage === 1) state = performDeepResearch(state);
        if (stage === 2) state = performRootConnection(state);
        if (stage === 3) state = performOriginAnalysis(state);
      }
      const completed = state.scoreCapStage === 4 && state.runEarnedScore.gte(1e18), finalState = state;
      const afterRoot = completed ? performRootRebirth(state) : null;
      cycles.push({ cycle, initialState, state: finalState, afterRoot, stages, completed, startsAtSeconds,
        elapsedSeconds: elapsedSeconds - startsAtSeconds, multiplier: getGearMultiplier(state.permanent),
        unlocked: GEAR_IDS.filter((id) => state.permanent.gearUnlocked[id]), production: getProductionPerSecond(state) });
      if (!afterRoot) break;
      state = afterRoot;
    }
    return { scenario, policy, automated: previous.automated, firstRootSeconds: previous.totalSeconds, cycles, trace, state, elapsedSeconds,
      completed: cycles.length === 3 && cycles.every((cycle) => cycle.completed), totalSeconds: previous.totalSeconds + elapsedSeconds };
  }));
}
