import { GEAR } from '../data/gear';
import { simulateGear } from './gear';
import { INITIAL_BALANCE } from '../data/balance';
import { EQUIPMENT, ROOT_LINK_PRODUCTION } from '../data/equipment';
import { PRESTIGE_BALANCE, SKILLS } from '../data/skills';
import { OFFLINE_LIMIT_SECONDS, SAVE_VERSION } from '../core/save';
import { getProductionPerSecond } from '../core/game';
import { createInitialState } from '../core/state';
import { COVERAGE, SCENARIOS } from './scenarios';
import type { Scenario } from './simulator';
import { simulateCampaign, simulateRun } from './simulator';
import { projectFixedProduction } from './projections';
import { SKILL_PLANS } from './policies';
import { EQUIPMENT_BASELINE } from './baseline';
import { BREAKTHROUGH_SCENARIOS, simulateBreakthroughJourney, simulateExpansion } from './expansion';
import { simulateAutomation } from './automation';
import { simulateResearch } from './research';
import { RESEARCH } from '../data/research';
import { simulateRootConnections } from './rootConnection';
import { ROOT_REWARDS, ROOT_UPGRADES, ROOT_FIRST_PRODUCTION_MULTIPLIER } from '../data/root';
import { simulateRootCycles } from './root';
import { simulateOrigins } from './origin';
import { ORIGIN_RESEARCH } from '../data/originResearch';
import { simulateDepth } from './depth';
import { DEPTH_BALANCE, DIG_RESEARCH, STRATA } from '../data/depth';

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
  const breakthroughJourneys = BREAKTHROUGH_SCENARIOS.map((scenario) => simulateBreakthroughJourney(scenario, maxSeconds));
  const breakthroughSeed = breakthroughJourneys[0]?.beforeBreakthrough;
  const research = simulateResearch(maxSeconds);
  const rootConnections = simulateRootConnections(research, maxSeconds);
  const origins = simulateOrigins(rootConnections, maxSeconds);
  return {
    formatVersion: 2,
    parameters: { balance: INITIAL_BALANCE, equipment: EQUIPMENT, prestige: PRESTIGE_BALANCE,
      skills: SKILLS, gear: GEAR, root: { rewards: ROOT_REWARDS, upgrades: ROOT_UPGRADES, firstProductionMultiplier: ROOT_FIRST_PRODUCTION_MULTIPLIER }, research: RESEARCH, originResearch: ORIGIN_RESEARCH, depth: { balance: DEPTH_BALANCE, strata: STRATA, digResearch: DIG_RESEARCH }, rootLink: { relaysPerLink: 2, baseProduction: ROOT_LINK_PRODUCTION }, offlineLimitSeconds: OFFLINE_LIMIT_SECONDS, saveVersion: SAVE_VERSION },
    runCount, maxSeconds, skillPlans: SKILL_PLANS, coverage: COVERAGE, campaigns, benchmarks,
    equipmentBaseline: EQUIPMENT_BASELINE,
    breakthroughJourneys,
    automation: simulateAutomation(maxSeconds),
    research,
    rootConnections,
    origins,
    rootCycles: simulateRootCycles(origins, maxSeconds),
    gear: simulateGear(origins, maxSeconds),
    depth: simulateDepth(rootConnections, maxSeconds),
    expansion: breakthroughSeed ? simulateExpansion(breakthroughSeed) : [],
    projectionReference: referenceProduction === null ? null : {
      scenarioId: reference!.scenario.id, run: lastCompleted!.run, production: referenceProduction,
    },
    projections: referenceProduction === null ? [] : projectFixedProduction(referenceProduction),
  };
}
export type SimulationSuite = ReturnType<typeof runSuite>;
