import { configureAutomation } from '../core/game';
import { performBreakthrough } from '../core/breakthrough';
import { prestigeGame } from '../core/prestige';
import { AUTOMATION_POLICIES } from '../data/automation';
import type { AutomationPolicy } from '../data/automation';
import { BREAKTHROUGH_SCENARIOS, simulateBreakthroughJourney } from './expansion';
import { simulateRun } from './simulator';
import type { Scenario } from './simulator';

export function simulateAutomation(maxSeconds: number) {
  const policies = ['off', ...Object.keys(AUTOMATION_POLICIES)] as const;
  const schedules = BREAKTHROUGH_SCENARIOS.slice(0, 3);
  const journeys = schedules.flatMap((schedule) => policies.map((policy) => {
    const scenario: Scenario = { ...schedule, id: `automation-journey-${schedule.id}-${policy}`,
      label: `${schedule.label} / ${policy}`, skillPlan: policy === 'off' ? 'breakthrough' : 'automation-first',
      automation: policy === 'off' ? undefined : policy as AutomationPolicy };
    return simulateBreakthroughJourney(scenario, maxSeconds);
  }));
  const seed = journeys.find((journey) => journey.scenario.automation === 'efficient')?.beforeBreakthrough;
  const trials = !seed ? [] : ([0, 1] as const).flatMap((stage) => schedules.flatMap((schedule) => policies.map((policy) => {
    const base = stage === 0 ? prestigeGame(seed) : performBreakthrough(seed);
    const initialState = configureAutomation(base, { ...base.automation, enabled: policy !== 'off', policy: policy === 'off' ? 'efficient' : policy as AutomationPolicy });
    const scenario: Scenario = { ...schedule, id: `automation-${stage}-${schedule.visitSeconds}-${policy}`,
      label: `${stage === 0 ? '1e6' : '1e9'} / ${schedule.visitSeconds === 60 ? '1分' : schedule.visitSeconds === 21_600 ? '6時間' : '12時間'} / ${policy}`,
      skillPlan: 'save', automation: policy === 'off' ? undefined : policy as AutomationPolicy };
    return { policy, stage, scenario, initialState, result: simulateRun(initialState, scenario, 7 * 86_400) };
  })));
  return { journeys, trials };
}
