import { canBreakthrough, performBreakthrough } from '../core/breakthrough';
import { getProductionPerSecond } from '../core/game';
import { prestigeGame, getPrestigeReward } from '../core/prestige';
import { createInitialState } from '../core/state';
import type { GameState } from '../core/state';
import { createSave, parseSave, serializeSave } from '../core/save';
import { INITIAL_EQUIPMENT_IDS } from '../data/equipment';
import { investSkills } from './policies';
import { simulateRun } from './simulator';
import type { CampaignRun, Scenario, TracePoint } from './simulator';

/** ポイントもスキルも実コアで取得し、現在の周回を継続して初回突破する。 */
export function simulateBreakthroughJourney(scenario: Scenario, maxSeconds = 90 * 86_400) {
  let state = createInitialState();
  let elapsedSeconds = 0;
  let permissionAtSeconds: number | null = null;
  let firstScore1mSeconds: number | null = null;
  const runs: CampaignRun[] = [];
  const trace: TracePoint[] = [];
  let beforeBreakthrough: GameState | null = null;
  let afterBreakthrough: GameState | null = null;
  let expansion: ReturnType<typeof simulateRun> | null = null;
  for (let run = 1; elapsedSeconds < maxSeconds && run <= 100; run += 1) {
    const policy = state.permanent.skillRanks.breakthrough > 0 ? { ...scenario, prestigeAt: 'cap' as const } : scenario;
    const result = simulateRun(state, policy, maxSeconds - elapsedSeconds);
    trace.push(...result.trace.map((point) => ({ ...point, run, elapsedSeconds: point.elapsedSeconds + elapsedSeconds })));
    if (result.score1m) firstScore1mSeconds ??= elapsedSeconds + result.score1m.observedSeconds;
    const startsAtSeconds = elapsedSeconds;
    elapsedSeconds += result.elapsedSeconds;
    state = result.state;
    if (canBreakthrough(state)) {
      beforeBreakthrough = state;
      afterBreakthrough = parseSave(serializeSave(createSave(performBreakthrough(state), 0))).gameState;
      runs.push({ run, startsAtSeconds, result, reward: 0, afterPrestige: null });
      if (elapsedSeconds < maxSeconds) {
        expansion = simulateRun(afterBreakthrough, { ...scenario, prestigeAt: 'cap' }, maxSeconds - elapsedSeconds);
        trace.push(...expansion.trace.map((point) => ({ ...point, run, elapsedSeconds: point.elapsedSeconds + elapsedSeconds })));
        elapsedSeconds += expansion.elapsedSeconds;
        state = expansion.state;
      } else state = afterBreakthrough;
      break;
    }
    if (!result.completed) { runs.push({ run, startsAtSeconds, result, reward: 0, afterPrestige: null }); break; }
    const reward = getPrestigeReward(state);
    state = investSkills(prestigeGame(state), scenario.skillPlan, scenario.automation);
    if (state.permanent.skillRanks.breakthrough > 0) permissionAtSeconds ??= elapsedSeconds;
    runs.push({ run, startsAtSeconds, result, reward, afterPrestige: state });
  }
  return { scenario, completed: expansion?.completed ?? false, firstScore1mSeconds, permissionAtSeconds,
    breakthroughAtSeconds: beforeBreakthrough ? runs.at(-1)!.startsAtSeconds + runs.at(-1)!.result.elapsedSeconds : null,
    elapsedSeconds, state, beforeBreakthrough, afterBreakthrough, expansion, runs, trace };
}

export const BREAKTHROUGH_SCENARIOS: readonly Scenario[] = [
  { id: 'breakthrough-active-60', label: '1分確認・突破優先', visitSeconds: 60, presence: 'online', prestigeAt: 'cap', equipment: 'payback', skillPlan: 'breakthrough' },
  { id: 'breakthrough-offline-6h', label: '6時間復帰・突破優先', visitSeconds: 21_600, presence: 'offline', prestigeAt: 'cap', equipment: 'payback', skillPlan: 'breakthrough' },
  { id: 'breakthrough-offline-12h', label: '12時間復帰・突破優先', visitSeconds: 43_200, presence: 'offline', prestigeAt: 'cap', equipment: 'payback', skillPlan: 'breakthrough' },
  { id: 'breakthrough-early-60', label: '1分確認・早期転生から突破', visitSeconds: 60, presence: 'online', prestigeAt: 'early', equipment: 'payback', skillPlan: 'breakthrough' },
  { id: 'breakthrough-late-60', label: '1分確認・既存スキル買切り後に突破', visitSeconds: 60, presence: 'online', prestigeAt: 'cap', equipment: 'payback', skillPlan: 'late-breakthrough' },
];

/** 正規の突破可能状態から、同一の保存・生産・購入APIで9通りを比較する。 */
export function simulateExpansion(initial: GameState) {
  if (!canBreakthrough(initial)) throw new RangeError('Expansion comparison requires actual breakthrough permission and a capped run.');
  const expanded = performBreakthrough(initial);
  const schedules = [
    { id: 'active-60', label: '1分確認', visitSeconds: 60, presence: 'online' },
    { id: 'offline-6h', label: '6時間ごと復帰', visitSeconds: 21_600, presence: 'offline' },
    { id: 'offline-12h', label: '12時間ごと復帰', visitSeconds: 43_200, presence: 'offline' },
  ] as const;
  return schedules.flatMap((schedule) => (['fixed', 'existing', 'expanded'] as const).map((policy) => {
    const scenario: Scenario = { ...schedule, id: `expanded-${schedule.id}-${policy}`,
      equipment: policy === 'fixed' ? 'none' : 'payback',
      equipmentIds: policy === 'existing' ? INITIAL_EQUIPMENT_IDS : undefined,
      prestigeAt: 'cap', skillPlan: 'save' };
    const result = simulateRun(expanded, scenario, 7 * 86_400);
    return { scenario, policy, assumed: false, actualSaveSupported: true,
      initialState: expanded, result, finalProduction: getProductionPerSecond(result.state) };
  }));
}
