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
    expect(run.state.runEarnedScore).toBe(1_000_000);
    expect(run.state.imo).toBe(1_000_000);
    expect(run.purchases).toBe(0);
    expect(run.trace.at(-1)?.actualProduction).toBe(0);
  });

  it('distinguishes reaching SCORE from the next manual confirmation', () => {
    const run = simulateRun(createInitialState(), { ...idle, visitSeconds: 600, prestigeAt: 'early' }, 200_000);
    expect(run.score100k?.productionSeconds).toBe(100_000);
    expect(run.score100k?.observedSeconds).toBe(100_200);
    expect(run.elapsedSeconds).toBe(100_200);
    expect(run.state.runEarnedScore).toBe(100_200);
  });

  it('does not invent an extra manual action at an online horizon boundary', () => {
    const state = { ...createInitialState(), imo: 99_999, runEarnedScore: 99_999 };
    const run = simulateRun(state, { ...idle, visitSeconds: 60, prestigeAt: 'early' }, 30);
    expect(run.state.runEarnedScore).toBe(100_029);
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
    const state = { ...createInitialState(), imo: 9, runEarnedScore: 999_999 };
    const run = simulateRun(state, { ...idle, presence: 'offline', visitSeconds: 3_600 }, 3_600);
    expect(run.state.imo).toBe(10);
    expect(run.state.runEarnedScore).toBe(1_000_000);
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
    const second = runSuite();
    expect(first).toEqual(second);
    expect(first.campaigns).toHaveLength(15);
    for (const campaign of first.campaigns) {
      expect(campaign.completedRuns).toBe(6);
      expect(campaign.state.permanent.prestigeCount).toBe(6);
      expect(campaign.trace.every((point) => point.score <= 1_000_000 && point.scoreCap === 1_000_000 && point.imo >= 0)).toBe(true);
      expect(campaign.runs.every((run) => getProductionPerSecond(run.result.state) > 0)).toBe(true);
    }
  });

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
    const state = { ...createInitialState(), imo: 1_000, runEarnedScore: 1_000 };
    Object.freeze(state.equipmentCounts);
    Object.freeze(state.permanent.skillRanks);
    Object.freeze(state.permanent);
    Object.freeze(state);
    expect(investEquipment(state, 'none').state).toBe(state);
    for (const policy of ['payback', 'highest-tier'] as const) {
      const result = investEquipment(state, policy);
      expect(result.purchased).toBeGreaterThan(0);
      expect(result.state.runEarnedScore).toBe(1_000);
      expect(result.state.imo).toBeGreaterThanOrEqual(0);
      expect(getProductionPerSecond(result.state)).toBeGreaterThan(1);
    }
    expect(state.imo).toBe(1_000);
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
    expect(first.requiredProduction * first.targetSeconds).toBe(999_000_000);
    expect(rows[1]?.seconds).toBe(first.seconds / 10);
    expect(rows).toHaveLength(12);
    expect(rows.at(-1)?.to).toBe(1e15);
    expect(() => projectFixedProduction(0)).toThrow(RangeError);
    expect(() => projectFixedProduction(Infinity)).toThrow(RangeError);
    expect(() => projectFixedProduction(1, -1)).toThrow(RangeError);
  });
});
