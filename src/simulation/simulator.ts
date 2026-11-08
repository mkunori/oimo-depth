import { applyGearPreset } from '../core/gearModes';
import { gearModeKey } from '../core/gearModeEffects';
import type { BuiltinGearPreset } from '../data/gearModes';
import { unlockGear } from '../core/gear';
import { getGearMultiplier, getSpendableScore } from '../core/gearProgress';
import { GEAR_IDS } from '../data/gear';
import { GameNumber, gn } from '../core/numbers';
import { getAmountSeconds, advanceWithAutomation, getEquipmentAvailability, getEquipmentPrice, getNextAutomaticPurchaseSeconds, getProductionPerSecond } from '../core/game';
import type { AutomaticProgress } from '../core/game';
import { AUTOMATION_POLICIES } from '../data/automation';
import type { AutomationPolicy } from '../data/automation';
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
import { ORIGIN_RESEARCH_IDS } from '../data/originResearch';
import { purchaseOriginResearch, purchaseResearch } from '../core/research';
import { purchaseDigResearch } from '../core/digResearch';
import { getDigPower, getDigSpeed, getStratum } from '../core/excavation';
import { DIG_RESEARCH_IDS, STRATA } from '../data/depth';

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
  readonly automation?: AutomationPolicy;
  readonly research?: 'geology-first' | 'resonance-first';
  readonly originResearch?: boolean;
  readonly gear?: 'early' | 'cap';
  readonly gearModePreset?: BuiltinGearPreset;
  readonly digResearch?: boolean;
}

export interface Milestone {
  /** この周回の、実際に精算した生産時間上の到達推計。 */
  readonly productionSeconds: number;
  /** 方策が次に確認した時刻。復帰しない間に手動操作は行わない。 */
  readonly observedSeconds: number;
}

export interface TracePoint {
  readonly scoreSpentThisRun: GameNumber;
  readonly spendableScore: GameNumber;
  readonly gearUnlocked: GameState['permanent']['gearUnlocked'];
  readonly gearMultiplier: number;
  readonly gearModes: GameState['permanent']['gearModes'];
  readonly originResearchRanks: GameState['originResearchRanks'];
  readonly depthMeters: number;
  readonly digSpeed: number;
  readonly digPower: number;
  readonly stratum: string;
  readonly digResearchRanks: GameState['permanent']['digResearchRanks'];
  readonly elapsedSeconds: number;
  readonly run: number;
  readonly kind: 'start' | 'decision' | 'cap-reached' | 'end' | 'prestige' | 'automatic-purchase' | 'research-purchase' | 'gear-unlock' | 'mode-change';
  readonly researchRanks: GameState['researchRanks'];
  readonly score: GameNumber;
  readonly imo: GameNumber;
  readonly production: GameNumber;
  readonly actualProduction: GameNumber;
  readonly prestigeCount: number;
  readonly scoreCap: GameNumber;
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
  readonly automaticPurchases: number;
  readonly score100k: Milestone | null;
  readonly score1m: Milestone | null;
  readonly state: GameState;
  readonly trace: readonly TracePoint[];
}

const TIME_EPSILON = 1e-7;
const MAX_DECISIONS = 100_000;
function depthTrace(state: GameState) {
  return { gearModes: state.permanent.gearModes, scoreSpentThisRun: state.scoreSpentThisRun, spendableScore: getSpendableScore(state), gearUnlocked: state.permanent.gearUnlocked, gearMultiplier: getGearMultiplier(state.permanent), originResearchRanks: state.originResearchRanks, depthMeters: state.permanent.depthMeters, digSpeed: state.runEarnedScore.gte(getScoreCap(state)) ? 0 : getDigSpeed(state),
    digPower: getDigPower(state), stratum: STRATA[getStratum(state.permanent.depthMeters)]!.name, digResearchRanks: state.permanent.digResearchRanks };
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite.`);
}

export function validateScenario(scenario: Scenario): void {
  if (scenario.gear !== undefined && (!['early', 'cap'].includes(scenario.gear) || scenario.visitSeconds === null)) throw new RangeError('Gear policy needs scheduled manual visits.');
  if (scenario.digResearch !== undefined && typeof scenario.digResearch !== 'boolean') throw new RangeError('Invalid dig research policy.');
  if (scenario.research !== undefined && scenario.research !== 'geology-first' && scenario.research !== 'resonance-first') throw new RangeError('Unknown research policy.');
  if (scenario.automation !== undefined && !Object.hasOwn(AUTOMATION_POLICIES, scenario.automation)) throw new RangeError('Unknown automation policy.');
  if (scenario.equipmentIds && (new Set(scenario.equipmentIds).size !== scenario.equipmentIds.length
    || scenario.equipmentIds.some((id) => !EQUIPMENT_IDS.includes(id)))) throw new RangeError('Invalid equipment selection.');
  if (!['online', 'offline'].includes(scenario.presence)
    || !['early', 'cap'].includes(scenario.prestigeAt)
    || !['none', 'payback', 'highest-tier', 'root-saving'].includes(scenario.equipment)
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
  let automaticPurchases = 0;
  let score100k: Milestone | null = initial.runEarnedScore.gte(PRESTIGE_BALANCE.unlockScore) ? { productionSeconds: 0, observedSeconds: 0 } : null;
  let score1m: Milestone | null = initial.runEarnedScore.gte(INITIAL_BALANCE.scoreCap) ? { productionSeconds: 0, observedSeconds: 0 } : null;
  const trace: TracePoint[] = [];

  const record = (kind: TracePoint['kind']) => {
    const production = getProductionPerSecond(state);
    trace.push({ ...depthTrace(state), elapsedSeconds: elapsed, run: 1, kind, score: state.runEarnedScore, imo: state.imo, production,
      actualProduction: state.runEarnedScore.gte(scoreCap) ? gn(0) : production,
      prestigeCount: state.permanent.prestigeCount, scoreCap: scoreCap, equipmentCounts: state.equipmentCounts, researchRanks: state.researchRanks });
  };
  const investGear = () => {
    if (!scenario.gear || !state.permanent.equipmentSystemUnlocked || (scenario.gear === 'cap' && state.runEarnedScore.lt(scoreCap))) return;
    for (const id of GEAR_IDS) {
      const next = unlockGear(state, id);
      if (next !== state) { state = next; record('gear-unlock'); }
    }
    if (scenario.gearModePreset) {
      const next = applyGearPreset(state, scenario.gearModePreset);
      if (gearModeKey(next.permanent) !== gearModeKey(state.permanent)) { state = next; record('mode-change'); }
    }
  };
  const invest = () => {
    investGear();
    // 研究は訪問時の手動操作だけ。ONでもオフライン進行中には実行しない。
    if (scenario.originResearch && state.scoreCapStage === 4) {
      for (const id of ORIGIN_RESEARCH_IDS) for (let rank = 0; rank < 3; rank += 1) {
        const next = purchaseOriginResearch(state, id);
        if (next === state) break;
        state = next; record('research-purchase');
      }
    }
    if (scenario.research && state.scoreCapStage >= 2) {
      const order = scenario.research === 'geology-first' ? ['geology', 'resonance'] as const : ['resonance', 'geology'] as const;
      for (const id of order) {
        while (true) {
          const next = purchaseResearch(state, id);
          if (next === state) break;
          state = next; record('research-purchase');
        }
      }
    }
    if (scenario.digResearch) for (const id of DIG_RESEARCH_IDS) {
      while (true) {
        const next = purchaseDigResearch(state, id);
        if (next === state) break;
        state = next; record('research-purchase');
      }
    }
    if (state.automation.enabled) return; // 自動購入ONでは手動購入を混ぜず、実コアの精算に委譲する。
    const result = investEquipment(state, scenario.equipment, equipmentIds);
    state = result.state;
    purchases += result.purchased;
    if (result.purchased > 0) purchaseDecisions += 1;
  };
  const advance = (seconds: number, isObservation: boolean) => {
    const before = state;
    let applied = seconds;
    let progress: AutomaticProgress;
    if (scenario.presence === 'offline') {
      // 実際のエクスポート/読込と同じ検証を経由し、復帰時のコア関数を呼ぶ。
      const saved = parseSave(serializeSave(createSave(before, 0)));
      const result = settleOffline(saved, Math.round(seconds * 1_000), true);
      state = result.save.gameState;
      applied = result.report.appliedSeconds;
      progress = result.progress!;
    } else { progress = advanceWithAutomation(before, seconds, before.automation.enabled); state = progress.state; }
    automaticPurchases += progress.purchaseCount;
    purchases += progress.purchaseCount;
    for (const event of progress.events) {
      const production = getProductionPerSecond(event.state);
      trace.push({ ...depthTrace(event.state), elapsedSeconds: elapsed + event.seconds, run: 1, kind: 'automatic-purchase', score: event.state.runEarnedScore,
        imo: event.state.imo, production, actualProduction: production, prestigeCount: event.state.permanent.prestigeCount,
        scoreCap: scoreCap, equipmentCounts: event.state.equipmentCounts, researchRanks: event.state.researchRanks });
    }
    const transitions = [{ seconds: 0, state: before }, ...progress.events, { seconds: applied, state }];
    const crossing = (threshold: GameNumber): Milestone | null => {
      if (before.runEarnedScore.gte(threshold) || state.runEarnedScore.lt(threshold)) return null;
      const index = transitions.findIndex((point) => point.state.runEarnedScore.gte(threshold));
      const previous = transitions[index - 1]!;
      return { productionSeconds: credited + previous.seconds + (getAmountSeconds(threshold.subtract(previous.state.runEarnedScore), getProductionPerSecond(previous.state), applied) ?? applied), observedSeconds: elapsed + seconds };
    };
    if (isObservation) {
      score100k ??= crossing(PRESTIGE_BALANCE.unlockScore);
      score1m ??= crossing(INITIAL_BALANCE.scoreCap);
    }
    if (before.runEarnedScore.lt(scoreCap) && progress.capAtSeconds !== null) {
      trace.push({ ...depthTrace(state), elapsedSeconds: elapsed + progress.capAtSeconds, run: 1, kind: 'cap-reached',
        score: state.runEarnedScore, imo: state.imo, production: getProductionPerSecond(state), actualProduction: gn(0),
        prestigeCount: state.permanent.prestigeCount, scoreCap: scoreCap, equipmentCounts: state.equipmentCounts, researchRanks: state.researchRanks });
    }
    idle += progress.capAtSeconds === null ? 0 : Math.max(0, applied - progress.capAtSeconds);
    credited += applied;
    discarded += seconds - applied;
    elapsed += seconds;
    if (isObservation) observed = elapsed;
  };

  record('start');
  if (state.runEarnedScore.lt(target)) invest();
  record('decision');
  for (let decision = 0; state.runEarnedScore.lt(target) && elapsed < maxSeconds; decision += 1) {
    if (decision >= MAX_DECISIONS) throw new RangeError('Decision limit reached; increase visit interval or shorten horizon.');
    const rate = getProductionPerSecond(state);
    let delta: number;
    if (scenario.visitSeconds !== null) delta = scenario.visitSeconds;
    else {
      const milestones = [target, PRESTIGE_BALANCE.unlockScore, INITIAL_BALANCE.scoreCap]
        .filter((score) => score.gt(state.runEarnedScore)).map((score) => getAmountSeconds(score.subtract(state.runEarnedScore), rate) ?? Infinity);
      const affordability = scenario.equipment === 'none' || state.automation.enabled ? [] : equipmentIds.map((id) =>
        getAmountSeconds(getEquipmentPrice(id, state.equipmentCounts[id], state.permanent).subtract(state.imo), rate) ?? Infinity);
      // わずかな時間を進め、価格直前の浮動小数点端数でゼロ時間ループにならないようにする。
      delta = Math.max(TIME_EPSILON, Math.min(...milestones, ...affordability, getNextAutomaticPurchaseSeconds(state) ?? Infinity) + TIME_EPSILON);
    }
    if (elapsed + delta > maxSeconds) {
      // オフライン方策では、設定にない途中復帰を作らない。
      if (scenario.presence === 'online') advance(maxSeconds - elapsed, false);
      elapsed = maxSeconds;
      break;
    }
    advance(delta, true);
    investGear();
    if (state.runEarnedScore.lt(target)) invest();
    record('decision');
  }
  record('end');
  return { completed: state.runEarnedScore.gte(target) && elapsed === observed, elapsedSeconds: elapsed, lastObservationSeconds: observed,
    creditedSeconds: credited, discardedOfflineSeconds: discarded, idleAtCapSeconds: idle,
    purchases, purchaseDecisions, automaticPurchases, score100k, score1m, state, trace };
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
    const afterPrestige = result.completed ? investSkills(prestigeGame(result.state), scenario.skillPlan, scenario.automation) : null;
    runs.push({ run, startsAtSeconds: elapsed, result, reward, afterPrestige });
    elapsed += result.elapsedSeconds;
    state = afterPrestige ?? result.state;
    if (afterPrestige === null) break;
    trace.push({ ...depthTrace(state), elapsedSeconds: elapsed, run, kind: 'prestige', score: state.runEarnedScore, imo: state.imo,
      production: getProductionPerSecond(state), actualProduction: getProductionPerSecond(state),
      prestigeCount: state.permanent.prestigeCount, scoreCap: getScoreCap(state), equipmentCounts: state.equipmentCounts, researchRanks: state.researchRanks });
  }
  return { scenario, requestedRuns: runCount, completedRuns: runs.filter((run) => run.result.completed).length, elapsedSeconds: elapsed, state, runs, trace };
}
export type CampaignResult = ReturnType<typeof simulateCampaign>;
