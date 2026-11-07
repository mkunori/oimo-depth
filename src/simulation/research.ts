import { gn } from '../core/numbers';
import { getAmountSeconds, configureAutomation, getProductionPerSecond } from '../core/game';
import { performDeepResearch } from '../core/research';
import { createSave, parseSave, serializeSave } from '../core/save';
import { BREAKTHROUGH_SCENARIOS, simulateBreakthroughJourney } from './expansion';
import { simulateRun } from './simulator';
import type { Scenario } from './simulator';

/** 初期状態から正規の権限取得と1E9到達を経由する。自動購入なし経路も別途取得する。 */
export function simulateResearch(maxSeconds: number) {
  return BREAKTHROUGH_SCENARIOS.slice(0, 3).flatMap((schedule) => ([false, true] as const).flatMap((automated) => {
    const journey = simulateBreakthroughJourney({ ...schedule,
      skillPlan: automated ? 'automation-first' : 'breakthrough', automation: automated ? 'efficient' : undefined }, maxSeconds);
    if (!journey.completed || journey.elapsedSeconds >= maxSeconds) return [];
    const unlocked = performDeepResearch(journey.state);
    const base = parseSave(serializeSave(createSave(unlocked, 0))).gameState;
    const initialState = configureAutomation(base, { ...base.automation, enabled: automated });
    return (['equipment-only', 'geology-first', 'resonance-first'] as const).map((policy) => {
      const scenario: Scenario = { ...schedule, id: `research-${schedule.visitSeconds}-${automated ? 'auto' : 'manual'}-${policy}`,
        label: `${schedule.label} / ${automated ? '自動' : '手動'} / ${policy}`, skillPlan: 'save',
        research: policy === 'equipment-only' ? undefined : policy, automation: automated ? 'efficient' : undefined };
      const result = simulateRun(initialState, scenario, maxSeconds - journey.elapsedSeconds);
      const initialProduction = getProductionPerSecond(initialState);
      const finalProduction = getProductionPerSecond(result.state);
      return { scenario, policy, automated, initialState, result, initialProduction, finalProduction,
        productionMultiplier: finalProduction.divide(initialProduction),
        capOnlySeconds: getAmountSeconds(gn(1e12).subtract(1e9), initialProduction)!,
        beforeResearchSeconds: journey.elapsedSeconds, totalSeconds: journey.elapsedSeconds + result.elapsedSeconds };
    });
  }));
}
