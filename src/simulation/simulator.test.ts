import { testAmount as gn, stringifyTestSave } from '../test/amounts';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceGame, getProductionPerSecond } from '../core/game';
import { prestigeGame, purchaseSkill } from '../core/prestige';
import { createSave, settleOffline } from '../core/save';
import { createInitialState } from '../core/state';
import { investEquipment, investSkills } from './policies';
import { projectFixedProduction } from './projections';
import { SCENARIOS } from './scenarios';
import { simulateCampaign, simulateRun } from './simulator';
import type { Scenario } from './simulator';
import { runSuite } from './suite';
import { BREAKTHROUGH_SCENARIOS, simulateBreakthroughJourney, simulateExpansion } from './expansion';
import { EQUIPMENT_BASELINE } from './baseline';
import { assertV6BalanceBaseline } from '../test/migrationBaseline';

const idle: Scenario = { id: 'test', label: 'analytic baseline', visitSeconds: null,
  presence: 'online', equipment: 'none', skillPlan: 'save', prestigeAt: 'cap' };

afterEach(() => vi.restoreAllMocks());

describe('event-driven simulation', () => {
  it('matches the analytic one-imo/second baseline at both milestones', () => {
    const run = simulateRun(createInitialState(), idle, 2_000_000);
    expect(run.completed).toBe(true);
    expect(run.elapsedSeconds).toBeCloseTo(1_000_000, 5);
    expect(run.score100k?.productionSeconds).toBeCloseTo(100_000, 6);
    expect(run.score1m?.productionSeconds).toBeCloseTo(1_000_000, 6);
    expect(run.state.runEarnedScore).toBeAmount(1_000_000);
    expect(run.state.imo).toBeAmount(1_000_000);
    expect(run.purchases).toBe(0);
    expect(run.trace.at(-1)?.actualProduction).toBeAmount(0);
  });

  it('distinguishes reaching SCORE from the next manual confirmation', () => {
    const run = simulateRun(createInitialState(), { ...idle, visitSeconds: 600, prestigeAt: 'early' }, 200_000);
    expect(run.score100k?.productionSeconds).toBe(100_000);
    expect(run.score100k?.observedSeconds).toBe(100_200);
    expect(run.elapsedSeconds).toBe(100_200);
    expect(run.state.runEarnedScore).toBeAmount(100_200);
  });

  it('does not invent an extra manual action at an online horizon boundary', () => {
    const state = { ...createInitialState(), imo: gn(99_999), runEarnedScore: gn(99_999) };
    const run = simulateRun(state, { ...idle, visitSeconds: 60, prestigeAt: 'early' }, 30);
    expect(run.state.runEarnedScore).toBeAmount(100_029);
    expect(run.completed).toBe(false);
    expect(run.score100k).toBeNull();
    expect(run.lastObservationSeconds).toBe(0);
  });

  it('does not invent a login before an offline policy returns', () => {
    const run = simulateRun(createInitialState(), { ...idle, presence: 'offline', visitSeconds: 21_600 }, 900);
    expect(run.completed).toBe(false);
    expect(run.lastObservationSeconds).toBe(0);
    expect(run.state).toEqual(createInitialState());
    expect(run.creditedSeconds).toBe(0);
  });

  it.each([3_600, 48 * 3_600])('matches real offline settlement for a %s second absence', (seconds) => {
    let state = prestigeGame(advanceGame(createInitialState(), 1_000_000));
    state = purchaseSkill(state, 'harvest');
    const run = simulateRun(state, { ...idle, presence: 'offline', visitSeconds: seconds }, seconds);
    const actual = settleOffline(createSave(state, 0), seconds * 1_000);
    expect(run.state).toEqual(actual.save.gameState);
    expect(run.creditedSeconds).toBe(Math.min(seconds, 86_400));
    expect(run.discardedOfflineSeconds).toBe(Math.max(0, seconds - 86_400));
    expect(run.state.permanent).toEqual(state.permanent);
  });

  it('records cap idle time while still waiting for the scheduled return', () => {
    const state = { ...createInitialState(), imo: gn(9), runEarnedScore: gn(999_999) };
    const run = simulateRun(state, { ...idle, presence: 'offline', visitSeconds: 3_600 }, 3_600);
    expect(run.state.imo).toBeAmount(10);
    expect(run.state.runEarnedScore).toBeAmount(1_000_000);
    expect(run.idleAtCapSeconds).toBe(3_599);
    expect(run.trace.find((point) => point.kind === 'cap-reached')?.elapsedSeconds).toBe(1);
    expect(run.score1m?.observedSeconds).toBe(3_600);
  });

  it('earns actual 2pt at the cap even when an infrequent player intended early prestige', () => {
    const scenario = SCENARIOS.find((item) => item.id === 'offline-6h-early')!;
    const campaign = simulateCampaign(scenario, 1);
    expect(campaign.runs[0]?.reward).toBe(2);
    expect(campaign.completedRuns).toBe(1);
    expect(campaign.state.permanent.prestigeCount).toBe(1);
    expect(campaign.elapsedSeconds).toBe(43_200);
  });

  it('marks a short horizon as censored without pretending a run or reward completed', () => {
    const campaign = simulateCampaign(idle, 6, 100);
    expect(campaign.completedRuns).toBe(0);
    expect(campaign.runs).toHaveLength(1);
    expect(campaign.runs[0]?.reward).toBe(0);
    expect(campaign.runs[0]?.afterPrestige).toBeNull();
    expect(campaign.runs[0]?.result.score100k).toBeNull();
    expect(campaign.state.permanent.prestigeCount).toBe(0);
  });

  it('is deterministic without ambient clocks or randomness and completes the default matrix', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('ambient clock'); });
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('randomness'); });
    const first = runSuite();
    assertV6BalanceBaseline(first);
    const second = runSuite();
    expect(first).toEqual(second);
    expect(first.campaigns).toHaveLength(15);
    expect(first.research).toHaveLength(18);
    for (const trial of first.research) {
      expect(trial.result.completed).toBe(true);
      expect(trial.initialState.runEarnedScore).toBeAmount(1e9);
      expect(trial.initialState.permanent.deepResearchUnlocked).toBe(true);
      expect(trial.initialState.permanent.deepResearchCount).toBe(1);
      expect(trial.initialState.postDeepResearchSkillLock).toBe(true);
      expect(trial.initialState.permanent.skillRanks.harvest).toBe(0);
      expect(trial.initialState.permanent.skillRanks.discount).toBe(0);
      expect(trial.initialState.permanent.skillRanks.automation > 0).toBe(trial.automated);
      expect(trial.result.state.runEarnedScore).toBeAmount(1e12);
      expect(trial.result.state.equipmentCounts.veinExtractor).toBeGreaterThan(0);
      expect(trial.result.state.equipmentCounts.concentrator).toBeGreaterThan(0);
      expect(trial.result.trace.filter((point) => point.kind === 'research-purchase').every((point) => point.elapsedSeconds % trial.scenario.visitSeconds! === 0)).toBe(true);
      if (trial.policy !== 'equipment-only') expect(trial.result.elapsedSeconds).toBeLessThanOrEqual(first.research.find((other) => other.automated === trial.automated && other.scenario.visitSeconds === trial.scenario.visitSeconds && other.policy === 'equipment-only')!.result.elapsedSeconds);
    }
    // #37 intentionally slows the first research interval; use a few representative
    // schedules while the fixed v6 baseline continues guarding all earlier routes.
    for (const [visit, manual, auto] of [[60, 6900, 3060], [21600, 43200, 21600], [43200, 86400, 43200]]) {
      const trials = first.research.filter((trial) => trial.policy === 'geology-first' && trial.scenario.visitSeconds === visit);
      expect(trials.map((trial) => trial.result.elapsedSeconds)).toEqual([manual, auto]);
    }
    for (const campaign of first.campaigns) {
      expect(campaign.completedRuns).toBe(6);
      expect(campaign.state.permanent.prestigeCount).toBe(6);
      expect(campaign.trace.every((point) => point.score.lte(1_000_000) && point.scoreCap.equals(1_000_000) && point.imo.gte(0))).toBe(true);
      expect(campaign.trace.every((point) => point.equipmentCounts.deepDrill === 0 && point.equipmentCounts.refinery === 0)).toBe(true);
      expect(campaign.runs.every((run) => getProductionPerSecond(run.result.state).gt(0))).toBe(true);
    }
  }, 30_000); // 全方策を2回生成して比較するため、共有CI向けに個別の実行時間を確保する。

  it.each([0, -1, NaN, Infinity])('rejects invalid horizon %s', (seconds) => {
    expect(() => simulateRun(createInitialState(), idle, seconds)).toThrow(RangeError);
  });

  it.each([0, -1, 0.5, NaN, Infinity])('rejects invalid visit interval %s', (visitSeconds) => {
    expect(() => simulateCampaign({ ...idle, visitSeconds })).toThrow(RangeError);
  });

  it('rejects invalid policy combinations, plans, run counts, and duplicate IDs', () => {
    expect(() => simulateCampaign({ ...idle, presence: 'offline' })).toThrow(RangeError);
    expect(() => simulateCampaign({ ...idle, skillPlan: 'missing' as Scenario['skillPlan'] })).toThrow(RangeError);
    expect(() => simulateCampaign(idle, 0)).toThrow(RangeError);
    expect(() => runSuite([idle, idle])).toThrow(RangeError);
    expect(() => runSuite([])).toThrow(RangeError);
  });
});

describe('simulation policy boundaries', () => {
  it('keeps input state immutable and makes only purchases the core permits', () => {
    const state = { ...createInitialState(), imo: gn(1_000), runEarnedScore: gn(1_000) };
    Object.freeze(state.equipmentCounts);
    Object.freeze(state.permanent.skillRanks);
    Object.freeze(state.permanent);
    Object.freeze(state);
    expect(investEquipment(state, 'none').state).toBe(state);
    for (const policy of ['payback', 'highest-tier'] as const) {
      const result = investEquipment(state, policy);
      expect(result.purchased).toBeGreaterThan(0);
      expect(result.state.runEarnedScore).toBeAmount(1_000);
      expect(result.state.imo).toBeGreaterThanOrEqualAmount(0);
      expect(getProductionPerSecond(result.state)).toBeGreaterThanAmount(1);
    }
    expect(state.imo).toBeAmount(1_000);
    expect(state.equipmentCounts.worker).toBe(0);
  });

  it('saves for the next planned rank rather than spending points on cheaper alternatives', () => {
    const state = purchaseSkill(prestigeGame(advanceGame(createInitialState(), 1_000_000)), 'harvest');
    expect(state.permanent.unspentPoints).toBe(1);
    expect(investSkills(state, 'harvest')).toBe(state);
    const next = prestigeGame(advanceGame(state, 100_000));
    expect(investSkills(next, 'harvest').permanent.skillRanks.harvest).toBe(2);
    expect(investSkills(state, 'discount').permanent.skillRanks.discount).toBe(1);
  });

  it('keeps future projections separate and exposes the production needed for a chosen duration', () => {
    const rows = projectFixedProduction(1_000);
    const first = rows[0]!;
    expect(first.seconds).toBe(999_000);
    expect(first.requiredProduction.multiply(first.targetSeconds)).toBeAmount(999_000_000);
    expect(rows[1]?.seconds).toBe(first.seconds / 10);
    expect(rows).toHaveLength(12);
    expect(rows.at(-1)?.to).toBeAmount(1e15);
    expect(() => projectFixedProduction(0)).toThrow(RangeError);
    expect(() => projectFixedProduction(Infinity)).toThrow(RangeError);
    expect(() => projectFixedProduction(1, -1)).toThrow(RangeError);
  });
});

describe('equipment growth comparison', () => {
  it('compares actual automation policies from equal seeds, with a low-cost unlock path', () => {
    const suite = runSuite();
    expect(suite.automation.trials).toHaveLength(24);
    expect(suite.automation.journeys).toHaveLength(12);
    for (const trial of suite.automation.trials) {
      expect(trial.result.completed).toBe(true);
      expect(trial.result.state.permanent).toEqual(trial.initialState.permanent);
      expect(trial.result.state.scoreCapStage).toBe(trial.stage);
      expect(trial.result.trace.every((point) => point.score.lte(point.scoreCap))).toBe(true);
      expect(trial.result.automaticPurchases > 0).toBe(trial.policy !== 'off');
      expect(trial.result.trace.some((point) => point.kind === 'automatic-purchase')).toBe(trial.policy !== 'off');
    }
    for (const stage of [0, 1]) {
      const inputs = suite.automation.trials.filter((trial) => trial.stage === stage);
      for (const trial of inputs) {
        expect(trial.initialState.equipmentCounts).toEqual(inputs[0]!.initialState.equipmentCounts);
        expect(trial.initialState.imo).toBeAmount(inputs[0]!.initialState.imo);
        expect(trial.initialState.permanent).toEqual(inputs[0]!.initialState.permanent);
      }
    }
    for (const journey of suite.automation.journeys) {
      expect(journey.completed).toBe(true);
      expect(journey.beforeBreakthrough?.permanent.prestigeCount).toBe(journey.scenario.automation ? 6 : 5);
    }
    const efficient = suite.automation.journeys.find((journey) => journey.scenario.automation === 'efficient' && journey.scenario.visitSeconds === 21_600)!;
    const off = suite.automation.journeys.find((journey) => !journey.scenario.automation && journey.scenario.visitSeconds === 21_600)!;
    expect(efficient.permissionAtSeconds!).toBeLessThan(off.permissionAtSeconds!);
    const initial = suite.automation.trials.find((trial) => trial.stage === 0 && trial.policy === 'efficient')!.initialState;
    const continuous = simulateRun(initial, { ...idle, automation: 'efficient' }, 86_400);
    expect(continuous.completed).toBe(true);
    expect(continuous.state.equipmentCounts).toEqual(advanceGame(initial, 86_400).equipmentCounts);
  });

  it('keeps the initial band within 25% of the established timing baseline', () => {
    const scenario = SCENARIOS.find((item) => item.id === 'active-60-cap')!;
    const current = simulateCampaign(scenario);
    const old = EQUIPMENT_BASELINE.campaigns.find((item) => item.id === scenario.id)!;
    const ratio = current.runs[0]!.result.elapsedSeconds / old.runs[0]!.seconds;
    expect(ratio).toBeGreaterThanOrEqual(0.75);
    expect(ratio).toBeLessThanOrEqual(1.25);
    expect(current.elapsedSeconds / old.elapsedSeconds).toBeGreaterThanOrEqual(0.75);
    for (const id of ['offline-6h-cap', 'offline-12h-cap']) {
      const selected = SCENARIOS.find((item) => item.id === id)!;
      const baseline = EQUIPMENT_BASELINE.campaigns.find((item) => item.id === id)!;
      expect(simulateCampaign(selected).runs.map((run) => run.result.elapsedSeconds)).toEqual(baseline.runs.map((run) => run.seconds));
    }
  });

  it('earns real permission and reaches 1e9 without resetting the breakthrough run', () => {
    const journeys = BREAKTHROUGH_SCENARIOS.map((scenario) => simulateBreakthroughJourney(scenario));
    for (const journey of journeys) {
      expect(journey.completed).toBe(true);
      expect(journey.beforeBreakthrough?.scoreCapStage).toBe(0);
      expect(journey.beforeBreakthrough?.runEarnedScore).toBeAmount(1e6);
      expect(journey.afterBreakthrough).toEqual({ ...journey.beforeBreakthrough, scoreCapStage: 1 });
      expect(journey.state.permanent).toEqual(journey.beforeBreakthrough?.permanent);
      expect(journey.state.runEarnedScore).toBeAmount(1e9);
      expect(journey.expansion!.state.equipmentCounts.deepDrill).toBeGreaterThan(0);
      expect(journey.expansion!.trace.at(-1)?.actualProduction).toBeAmount(0);
    }
    expect(journeys[0]!.state.permanent.prestigeCount).toBe(5);
    expect(journeys[3]!.state.permanent.prestigeCount).toBe(10);
    expect(journeys[4]!.state.permanent.prestigeCount).toBe(8);
    const seed = journeys[0]!.beforeBreakthrough!;
    const snapshot = stringifyTestSave(seed);
    const cases = simulateExpansion(seed);
    expect(cases).toHaveLength(9);
    for (const trial of cases) {
      expect(trial.assumed).toBe(false);
      expect(trial.actualSaveSupported).toBe(true);
      expect(trial.result.completed).toBe(true);
      expect(trial.result.state.runEarnedScore).toBeAmount(1e9);
      expect(trial.result.state.permanent).toEqual(seed.permanent);
      expect(trial.result.trace.every((point) => point.score.lte(1e9))).toBe(true);
      if (trial.policy === 'expanded') {
        expect(trial.result.state.equipmentCounts.deepDrill).toBeGreaterThan(0);
        expect(trial.result.state.equipmentCounts.refinery).toBeGreaterThan(0);
      } else {
        expect(trial.result.state.equipmentCounts.deepDrill).toBe(0);
        expect(trial.result.state.equipmentCounts.refinery).toBe(0);
      }
    }
    const existing = cases.find((trial) => trial.scenario.presence === 'online' && trial.policy === 'existing')!;
    const expanded = cases.find((trial) => trial.scenario.presence === 'online' && trial.policy === 'expanded')!;
    expect(expanded.result.elapsedSeconds).toBeLessThan(existing.result.elapsedSeconds);
    expect(expanded.finalProduction.divide(existing.finalProduction)).toBeGreaterThanAmount(3);
    expect(expanded.finalProduction.divide(existing.finalProduction)).toBeLessThanAmount(20);
    expect(stringifyTestSave(seed)).toBe(snapshot);
    expect(() => simulateExpansion(createInitialState())).toThrow(RangeError);
    const censored = simulateBreakthroughJourney(BREAKTHROUGH_SCENARIOS[1]!, 900);
    expect(censored.completed).toBe(false);
    expect(censored.beforeBreakthrough).toBeNull();
  });
});
