import { performRootConnection } from '../core/rootConnection';
import { configureAutomation, getProductionPerSecond, getRootLink } from '../core/game';
import { createSave, parseSave, serializeSave } from '../core/save';
import { EQUIPMENT_IDS, isRootEquipment } from '../data/equipment';
import type { simulateResearch } from './research';
import { simulateRun } from './simulator';

/** Reuse the actual initial→1e12 routes, including the first deep-memory reset.
 * The control disables the two new devices, rather than changing the physics. */
export function simulateRootConnections(research: ReturnType<typeof simulateResearch>, maxSeconds: number) {
  return research.filter((trial) => trial.policy === 'geology-first' && trial.result.completed && trial.totalSeconds < maxSeconds)
    .flatMap((previous) => (previous.scenario.visitSeconds === 60 && !previous.automated ? ['control', 'linked', 'saving'] as const : ['control', 'linked'] as const).map((policy) => {
      const linked = policy !== 'control';
      const unlocked = performRootConnection(previous.result.state);
      const equipmentIds = EQUIPMENT_IDS.filter((id) => linked || !isRootEquipment(id));
      const base = configureAutomation(unlocked, { ...unlocked.automation,
        equipment: { ...unlocked.automation.equipment, rootRelay: linked, coreChamber: linked } });
      const initialState = parseSave(serializeSave(createSave(base, 0))).gameState;
      const scenario = { ...previous.scenario, id: `root-${previous.scenario.visitSeconds}-${previous.automated ? 'auto' : 'manual'}-${policy}`,
        label: `${previous.scenario.label} / ${policy === 'saving' ? '連携設備へ貯蓄' : linked ? '連携設備あり' : '既存設備のみ'}`,
        equipment: policy === 'saving' ? 'root-saving' as const : previous.scenario.equipment, equipmentIds };
      const result = simulateRun(initialState, scenario, maxSeconds - previous.totalSeconds);
      const initialProduction = getProductionPerSecond(initialState), finalProduction = getProductionPerSecond(result.state);
      return { scenario, automated: previous.automated, linked, policy, initialState, result, initialProduction, finalProduction,
        productionMultiplier: finalProduction.divide(initialProduction), links: getRootLink(result.state.equipmentCounts).linked,
        beforeConnectionSeconds: previous.totalSeconds, totalSeconds: previous.totalSeconds + result.elapsedSeconds };
    }));
}
