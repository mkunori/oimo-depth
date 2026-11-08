import { prestigeGame } from '../core/prestige';
import { createSave, parseSave, serializeSave } from '../core/save';
import { investSkills } from './policies';
import { simulateRun } from './simulator';
import type { simulateOrigins } from './origin';

/** Keep the actual stage4 -> normal prestige -> SCORE0/stage2 route distinct
 * from ROOT cycles. Analysis/point rewards are never fabricated by the model. */
export function simulateDeepPrestige(origins: ReturnType<typeof simulateOrigins>, maxSeconds: number) {
  return origins.filter((trial) => trial.policy === 'research' && trial.result.completed
    && (trial.automated && [60, 21600].includes(trial.scenario.visitSeconds!) || !trial.automated && trial.scenario.visitSeconds === 43200))
    .map((source) => {
      const beforePrestige = source.result.state;
      const afterPrestige = parseSave(serializeSave(createSave(prestigeGame(beforePrestige), 0))).gameState;
      const initialState = investSkills(afterPrestige, 'breakthrough', source.automated ? 'efficient' : undefined);
      const scenario = { ...source.scenario, id: `deep-prestige-${source.scenario.visitSeconds}-${source.automated ? 'auto' : 'manual'}`,
        label: `${source.scenario.label} / 解析済み通常転生`, prestigeAt: 'cap' as const };
      const result = simulateRun(initialState, scenario, maxSeconds);
      return { scenario, automated: source.automated, beforePrestige, afterPrestige, initialState, result };
    });
}
