import { performOriginAnalysis } from '../core/origin';
import { configureAutomation, getProductionPerSecond, getRootLink } from '../core/game';
import { createSave, parseSave, serializeSave } from '../core/save';
import { EQUIPMENT_IDS, isOriginEquipment } from '../data/equipment';
import type { simulateRootConnections } from './rootConnection';
import { simulateRun } from './simulator';

/** Continue actual initial→1e15 routes. Only research is manual at each visit. */
export function simulateOrigins(roots: ReturnType<typeof simulateRootConnections>, maxSeconds: number) {
  return roots.filter((trial) => trial.policy === 'linked' && trial.result.completed && trial.totalSeconds < maxSeconds)
    .flatMap((previous) => (previous.scenario.visitSeconds === 21600 ? ['hold', 'equipment', 'research'] as const : ['research'] as const).map((policy) => {
      const unlocked = performOriginAnalysis(previous.result.state);
      const enabled = policy !== 'hold';
      const equipmentIds = EQUIPMENT_IDS.filter((id) => enabled || !isOriginEquipment(id));
      const base = configureAutomation(unlocked, { ...unlocked.automation,
        enabled: enabled && previous.automated,
        equipment: { ...unlocked.automation.equipment, originMiner: enabled, imoReactor: enabled } });
      const initialState = parseSave(serializeSave(createSave(base, 0))).gameState;
      const scenario = { ...previous.scenario, id: `origin-${previous.scenario.visitSeconds}-${previous.automated ? 'auto' : 'manual'}-${policy}`,
        label: `${previous.scenario.label} / ${policy === 'hold' ? '追加購入なし' : policy === 'equipment' ? '新設備あり・新研究なし' : '新設備・新研究あり'}`,
        equipment: policy === 'hold' ? 'none' as const : previous.scenario.equipment,
        equipmentIds, research: policy === 'hold' ? undefined : previous.scenario.research, originResearch: policy === 'research' };
      const result = simulateRun(initialState, scenario, maxSeconds - previous.totalSeconds);
      const initialProduction = getProductionPerSecond(initialState), finalProduction = getProductionPerSecond(result.state);
      return { scenario, automated: previous.automated, policy, initialState, result, initialProduction, finalProduction,
        productionMultiplier: finalProduction.divide(initialProduction), links: getRootLink(result.state.equipmentCounts).linked,
        beforeAnalysisSeconds: previous.totalSeconds, totalSeconds: previous.totalSeconds + result.elapsedSeconds };
    }));
}
