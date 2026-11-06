import { advanceGame, getEquipmentAvailability, getEquipmentPrice, getProductionPerSecond } from '../core/game';
import { getScoreCap } from '../data/scoreCaps';
import { getPrestigeReward, prestigeGame } from '../core/prestige';
import { createSave, parseSave, serializeSave, settleOffline } from '../core/save';
import { createInitialState } from '../core/state';
import type { GameState } from '../core/state';
import { INITIAL_BALANCE } from '../data/balance';
import { EQUIPMENT_IDS } from '../data/equipment';
import type { EquipmentId } from '../data/equipment';
import { PRESTIGE_BALANCE } from '../data/skills';
import { investEquipment, investSkills, SKILL_PLANS } from './policies';
import type { EquipmentPolicy, SkillPlan } from './policies';

export interface Scenario {
  readonly id: string;
  readonly label: string;
  /** null は購入可能時刻・スコア閾値ですぐ操作する比較。最適解の保証はない。 */
  readonly visitSeconds: number | null;
  readonly presence: 'online' | 'offline';
  readonly equipment: EquipmentPolicy;
  readonly skillPlan: SkillPlan;
  readonly prestigeAt: 'early' | 'cap';
  readonly equipmentIds?: readonly EquipmentId[];
}

export interface Milestone {
  /** この周回の、実際に精算した生産時間上の到達推計。 */
  readonly productionSeconds: number;
  /** 方策が次に確認した時刻。復帰しない間に手動操作は行わない。 */
  readonly observedSeconds: number;
}

export interface TracePoint {
  readonly elapsedSeconds: number;
  readonly run: number;
  readonly kind: 'start' | 'decision' | 'cap-reached' | 'end' | 'prestige';
  readonly score: number;
  readonly imo: number;
  readonly production: number;
  readonly actualProduction: number;
  readonly prestigeCount: number;
  readonly scoreCap: number;
  readonly equipmentCounts: GameState['equipmentCounts'];
}

export interface RunResult {
  readonly completed: boolean;
  readonly elapsedSeconds: number;
  readonly lastObservationSeconds: number;
  readonly creditedSeconds: number;
  readonly discardedOfflineSeconds: number;
  readonly idleAtCapSeconds: number;
  readonly purchases: number;
  readonly purchaseDecisions: number;
  readonly score100k: Milestone | null;
  readonly score1m: Milestone | null;
  readonly state: GameState;
  readonly trace: readonly TracePoint[];
}

const TIME_EPSILON = 1e-7;
const MAX_DECISIONS = 100_000;

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite.`);
}

export function validateScenario(scenario: Scenario): void {
  if (scenario.equipmentIds && (new Set(scenario.equipmentIds).size !== scenario.equipmentIds.length
    || scenario.equipmentIds.some((id) => !EQUIPMENT_IDS.includes(id)))) throw new RangeError('Invalid equipment selection.');
  if (!['online', 'offline'].includes(scenario.presence)
    || !['early', 'cap'].includes(scenario.prestigeAt)
    || !['none', 'payback', 'highest-tier'].includes(scenario.equipment)
    || !Object.hasOwn(SKILL_PLANS, scenario.skillPlan)) throw new RangeError('Unknown simulation policy.');
  if (scenario.visitSeconds !== null) {
    positive(scenario.visitSeconds, 'visitSeconds');
    if (!Number.isSafeInteger(scenario.visitSeconds) || scenario.visitSeconds < 1) throw new RangeError('Visits use whole seconds.');
  }
  if (scenario.presence === 'offline' && scenario.visitSeconds === null) throw new RangeError('Offline play needs a return interval.');
}

/** 実コアを呼ぶイベント駆動シミュレーター。時刻・乱数・保存領域にはアクセスしない。 */
export function simulateRun(initial: GameState, scenario: Scenario, maxSeconds: number): RunResult {
  validateScenario(scenario);
  positive(maxSeconds, 'maxSeconds');
  const scoreCap = getScoreCap(initial);
  const equipmentIds = (scenario.equipmentIds ?? EQUIPMENT_IDS).filter((id) => getEquipmentAvailability(id, initial).unlocked);
  getProductionPerSecond(initial);
  const target = scenario.prestigeAt === 'early' ? PRESTIGE_BALANCE.unlockScore : scoreCap;
  let state = initial;
  let elapsed = 0;
  let observed = 0;
  let credited = 0;
  let discarded = 0;
  let idle = 0;
  let purchases = 0;
  let purchaseDecisions = 0;
  let score100k: Milestone | null = initial.runEarnedScore >= PRESTIGE_BALANCE.unlockScore ? { productionSeconds: 0, observedSeconds: 0 } : null;
  let score1m: Milestone | null = initial.runEarnedScore >= INITIAL_BALANCE.scoreCap ? { productionSeconds: 0, observedSeconds: 0 } : null;
  const trace: TracePoint[] = [];

  const record = (kind: TracePoint['kind']) => {
    const production = getProductionPerSecond(state);
    trace.push({ elapsedSeconds: elapsed, run: 1, kind, score: state.runEarnedScore, imo: state.imo, production,
      actualProduction: state.runEarnedScore >= scoreCap ? 0 : production,
      prestigeCount: state.permanent.prestigeCount, scoreCap, equipmentCounts: state.equipmentCounts });
  };
  const invest = () => {
    const result = investEquipment(state, scenario.equipment, equipmentIds);
    state = result.state;
    purchases += result.purchased;
    if (result.purchased > 0) purchaseDecisions += 1;
  };
  const advance = (seconds: number, isObservation: boolean) => {
    const before = state;
    const rate = getProductionPerSecond(before);
    let applied = seconds;
    if (scenario.presence === 'offline') {
      // 実際のエクスポート/読込と同じ検証を経由し、復帰時のコア関数を呼ぶ。
      const saved = parseSave(serializeSave(createSave(before, 0)));
      const result = settleOffline(saved, Math.round(seconds * 1_000));
      state = result.save.gameState;
      applied = result.report.appliedSeconds;
    } else state = advanceGame(before, seconds);
    const crossing = (threshold: number): Milestone | null => before.runEarnedScore < threshold && state.runEarnedScore >= threshold
      ? { productionSeconds: credited + (threshold - before.runEarnedScore) / rate, observedSeconds: elapsed + seconds } : null;
    if (isObservation) {
      score100k ??= crossing(PRESTIGE_BALANCE.unlockScore);
      score1m ??= crossing(INITIAL_BALANCE.scoreCap);
    }
    const toCap = (scoreCap - before.runEarnedScore) / rate;
    if (before.runEarnedScore < scoreCap && state.runEarnedScore >= scoreCap) {
      trace.push({ elapsedSeconds: elapsed + Math.min(seconds, toCap), run: 1, kind: 'cap-reached',
        score: state.runEarnedScore, imo: state.imo, production: rate, actualProduction: 0,
        prestigeCount: state.permanent.prestigeCount, scoreCap, equipmentCounts: before.equipmentCounts });
    }
    idle += Math.max(0, applied - toCap);
    credited += applied;
    discarded += seconds - applied;
    elapsed += seconds;
    if (isObservation) observed = elapsed;
  };

  record('start');
  if (state.runEarnedScore < target) invest();
  record('decision');
  for (let decision = 0; state.runEarnedScore < target && elapsed < maxSeconds; decision += 1) {
    if (decision >= MAX_DECISIONS) throw new RangeError('Decision limit reached; increase visit interval or shorten horizon.');
    const rate = getProductionPerSecond(state);
    let delta: number;
    if (scenario.visitSeconds !== null) delta = scenario.visitSeconds;
    else {
      const milestones = [target, PRESTIGE_BALANCE.unlockScore, INITIAL_BALANCE.scoreCap]
        .filter((score) => score > state.runEarnedScore).map((score) => (score - state.runEarnedScore) / rate);
      const affordability = scenario.equipment === 'none' ? [] : equipmentIds.map((id) =>
        (getEquipmentPrice(id, state.equipmentCounts[id], state.permanent) - state.imo) / rate);
      // わずかな時間を進め、価格直前の浮動小数点端数でゼロ時間ループにならないようにする。
      delta = Math.max(TIME_EPSILON, Math.min(...milestones, ...affordability) + TIME_EPSILON);
    }
    if (elapsed + delta > maxSeconds) {
      // オフライン方策では、設定にない途中復帰を作らない。
      if (scenario.presence === 'online') advance(maxSeconds - elapsed, false);
      elapsed = maxSeconds;
      break;
    }
    advance(delta, true);
    if (state.runEarnedScore < target) invest();
    record('decision');
  }
  record('end');
  return { completed: state.runEarnedScore >= target && elapsed === observed, elapsedSeconds: elapsed, lastObservationSeconds: observed,
    creditedSeconds: credited, discardedOfflineSeconds: discarded, idleAtCapSeconds: idle,
    purchases, purchaseDecisions, score100k, score1m, state, trace };
}

export interface CampaignRun {
  readonly run: number;
  readonly startsAtSeconds: number;
  readonly result: RunResult;
  readonly reward: number;
  readonly afterPrestige: GameState | null;
}

export function simulateCampaign(scenario: Scenario, runCount = 6, maxSeconds = 90 * 86_400) {
  validateScenario(scenario);
  if (!Number.isSafeInteger(runCount) || runCount < 1 || runCount > 100) throw new RangeError('runCount must be 1..100.');
  positive(maxSeconds, 'maxSeconds');
  let state = createInitialState();
  let elapsed = 0;
  const runs: CampaignRun[] = [];
  const trace: TracePoint[] = [];
  for (let run = 1; run <= runCount && elapsed < maxSeconds; run += 1) {
    const result = simulateRun(state, scenario, maxSeconds - elapsed);
    trace.push(...result.trace.map((point) => ({ ...point, run, elapsedSeconds: point.elapsedSeconds + elapsed })));
    const reward = result.completed ? getPrestigeReward(result.state) : 0;
    const afterPrestige = result.completed ? investSkills(prestigeGame(result.state), scenario.skillPlan) : null;
    runs.push({ run, startsAtSeconds: elapsed, result, reward, afterPrestige });
    elapsed += result.elapsedSeconds;
    state = afterPrestige ?? result.state;
    if (afterPrestige === null) break;
    trace.push({ elapsedSeconds: elapsed, run, kind: 'prestige', score: state.runEarnedScore, imo: state.imo,
      production: getProductionPerSecond(state), actualProduction: getProductionPerSecond(state),
      prestigeCount: state.permanent.prestigeCount, scoreCap: INITIAL_BALANCE.scoreCap, equipmentCounts: state.equipmentCounts });
  }
  return { scenario, requestedRuns: runCount, completedRuns: runs.filter((run) => run.result.completed).length, elapsedSeconds: elapsed, state, runs, trace };
}
export type CampaignResult = ReturnType<typeof simulateCampaign>;
