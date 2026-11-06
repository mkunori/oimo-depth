import { INITIAL_BALANCE } from '../data/balance';
import { EQUIPMENT } from '../data/equipment';
import { PRESTIGE_BALANCE, SKILLS } from '../data/skills';
import { OFFLINE_LIMIT_SECONDS, SAVE_VERSION } from '../core/save';
import { getProductionPerSecond } from '../core/game';
import { createInitialState } from '../core/state';
import { COVERAGE, SCENARIOS } from './scenarios';
import type { Scenario } from './simulator';
import { simulateCampaign, simulateRun } from './simulator';
import { projectFixedProduction } from './projections';
import { SKILL_PLANS } from './policies';

export function runSuite(scenarios: readonly Scenario[] = SCENARIOS, runCount = 6, maxSeconds = 90 * 86_400) {
  if (scenarios.length === 0 || new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length) {
    throw new RangeError('Choose at least one scenario with unique IDs.');
  }
  const campaigns = scenarios.map((scenario) => simulateCampaign(scenario, runCount, maxSeconds));
  const benchmarks = scenarios.map((scenario) => ({ scenarioId: scenario.id,
    result: simulateRun(createInitialState(), { ...scenario, prestigeAt: 'cap' }, 900) }));
  // どの方策の生産力を投影したかをデータに残す。未完了なら投影対象を作らない。
  const reference = campaigns.find((campaign) => campaign.scenario.id === 'active-60-cap') ?? campaigns[0];
  const lastCompleted = reference?.runs.filter((run) => run.result.completed).at(-1);
  const referenceProduction = lastCompleted ? getProductionPerSecond(lastCompleted.result.state) : null;
  return {
    formatVersion: 1,
    parameters: { balance: INITIAL_BALANCE, equipment: EQUIPMENT, prestige: PRESTIGE_BALANCE,
      skills: SKILLS, offlineLimitSeconds: OFFLINE_LIMIT_SECONDS, saveVersion: SAVE_VERSION },
    runCount, maxSeconds, skillPlans: SKILL_PLANS, coverage: COVERAGE, campaigns, benchmarks,
    projectionReference: referenceProduction === null ? null : {
      scenarioId: reference!.scenario.id, run: lastCompleted!.run, production: referenceProduction,
    },
    projections: referenceProduction === null ? [] : projectFixedProduction(referenceProduction),
  };
}
export type SimulationSuite = ReturnType<typeof runSuite>;
