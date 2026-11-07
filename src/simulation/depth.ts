import { SCENARIOS } from './scenarios';
import { simulateCampaign, simulateRun } from './simulator';
import { prestigeGame } from '../core/prestige';
import type { simulateRootConnections } from './rootConnection';

/** Real six-run campaigns plus the actual pre-ROOT stage3 route; ROOT is not modeled. */
export function simulateDepth(roots: ReturnType<typeof simulateRootConnections>, maxSeconds: number) {
  const campaigns = [60, 21600, 43200].flatMap((visit) => [false, true].map((digResearch) => {
    const base = SCENARIOS.find((scenario) => scenario.visitSeconds === visit && scenario.prestigeAt === 'cap' && scenario.skillPlan === 'harvest')!;
    const scenario = { ...base, id: `depth-${visit}-${digResearch ? 'research' : 'harvest'}`, digResearch };
    const result = simulateCampaign(scenario, 6, maxSeconds);
    return { scenario, digResearch, result };
  }));
  const late = roots.filter((root) => root.automated && root.policy === 'linked').flatMap((root) => [false, true].map((digResearch) => {
    const scenario = { ...root.scenario, id: `depth-stage3-${root.scenario.visitSeconds}-${digResearch ? 'research' : 'harvest'}`, digResearch };
    const result = simulateRun(root.initialState, scenario, maxSeconds);
    const afterPrestige = prestigeGame(result.state);
    const resumed = simulateRun(afterPrestige, { ...scenario, prestigeAt: 'early' }, maxSeconds);
    return { scenario, digResearch, initialState: root.initialState, result, afterPrestige, resumed };
  }));
  return { campaigns, late };
}
