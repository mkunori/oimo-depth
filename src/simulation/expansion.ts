import { getProductionPerSecond } from '../core/game';
import { INITIAL_BALANCE } from '../data/balance';
import { INITIAL_EQUIPMENT_IDS } from '../data/equipment';
import type { GameState } from '../core/state';
import { simulateRun } from './simulator';
import type { Scenario } from './simulator';

/** 実際の突破権・操作・保存形式は #20 の対象。この定数は試算専用。 */
export const ASSUMED_EXPANSION = Object.freeze({ scoreCap: 1_000_000_000 });

export function simulateExpansion(initial: GameState) {
  getProductionPerSecond(initial);
  if (initial.runEarnedScore !== INITIAL_BALANCE.scoreCap) throw new RangeError('Expansion assumption starts at the current cap.');
  const schedules = [
    { id: 'active-60', label: '1分確認', visitSeconds: 60, presence: 'online' },
    { id: 'offline-6h', label: '6時間ごと復帰', visitSeconds: 21_600, presence: 'offline' },
    { id: 'offline-12h', label: '12時間ごと復帰', visitSeconds: 43_200, presence: 'offline' },
  ] as const;
  return schedules.flatMap((schedule) => (['fixed', 'existing', 'expanded'] as const).map((policy) => {
    const scenario: Scenario = {
      ...schedule, id: `assumed-${schedule.id}-${policy}`, economy: ASSUMED_EXPANSION,
      equipment: policy === 'fixed' ? 'none' : 'payback',
      equipmentIds: policy === 'existing' ? INITIAL_EQUIPMENT_IDS : undefined,
      prestigeAt: 'cap', skillPlan: 'save',
    };
    const result = simulateRun(initial, scenario, 7 * 86_400);
    return { scenario, policy, assumed: true, actualSaveSupported: false,
      initialState: initial, result, finalProduction: getProductionPerSecond(result.state, ASSUMED_EXPANSION) };
  }));
}
