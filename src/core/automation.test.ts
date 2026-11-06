import { describe, expect, it } from 'vitest';
import { advanceGame, advanceWithAutomation, configureAutomation, getEquipmentPrice, getProductionPerSecond, getPurchaseQuote, MAX_AUTOMATIC_PURCHASES, purchaseEquipment } from './game';
import { createInitialState } from './state';
import type { GameState } from './state';
import { prestigeGame, purchaseSkill } from './prestige';
import { performBreakthrough } from './breakthrough';
import { createSave, parseSave, serializeSave, settleOffline, SAVE_VERSION } from './save';
import { AUTOMATION_POLICIES, createDefaultAutomation, readAutomation } from '../data/automation';
import type { AutomationPolicy } from '../data/automation';
import { getScoreCap } from '../data/scoreCaps';
import { createBreakthroughReadyState } from '../test/progress';

function automated(policy: AutomationPolicy = 'efficient'): GameState {
  const harvested = purchaseSkill(prestigeGame(advanceGame(createInitialState(), 1e6)), 'harvest');
  return configureAutomation(purchaseSkill(harvested, 'automation'), { ...createDefaultAutomation(), enabled: true, policy });
}

describe('automated equipment buying', () => {
  it('requires the skill, defaults OFF after purchase, and preserves settings across prestige', () => {
    const initial = createInitialState();
    expect(configureAutomation(initial, { ...initial.automation, enabled: true })).toBe(initial);
    const state = purchaseSkill(purchaseSkill(prestigeGame(advanceGame(initial, 1e6)), 'harvest'), 'automation');
    expect(state.automation.enabled).toBe(false);
    expect(state.permanent.unspentPoints).toBe(0);
    const on = configureAutomation(state, { ...state.automation, enabled: true });
    const next = prestigeGame(advanceGame(on, 1e6));
    expect(next.automation).toEqual(on.automation);
    expect(next.scoreCapStage).toBe(0);
    expect(next.equipmentCounts).toEqual(initial.equipmentCounts);
    expect(next.permanent.skillRanks.automation).toBe(1);
  });

  it.each(Object.keys(AUTOMATION_POLICIES) as AutomationPolicy[])('matches online partitioning and 24h offline for %s', (policy) => {
    const initial = automated(policy);
    const whole = advanceGame(initial, 86_400);
    expect(settleOffline(createSave(initial, 0), 86_400_000).save.gameState).toEqual(whole);
    for (const step of [0.25, 0.37, 1, 60, 21_600]) {
      let state = initial;
      let seconds = 0;
      while (seconds < 86_400 && state.runEarnedScore < getScoreCap(state)) {
        const delta = Math.min(step, 86_400 - seconds);
        state = advanceGame(state, delta); seconds += delta;
      }
      state = advanceGame(state, 86_400 - seconds);
      expect(state.equipmentCounts).toEqual(whole.equipmentCounts);
      expect(state.imo).toBeCloseTo(whole.imo, 3);
      expect(state.runEarnedScore).toBeCloseTo(whole.runEarnedScore, 3);
      expect(state.permanent).toEqual(initial.permanent);
    }
    expect(whole.scoreCapStage).toBe(0);
    expect(whole.permanent.prestigeCount).toBe(1);
  });

  it('remains equivalent before reaching the cap and preserves the spent ledger', () => {
    const initial = automated();
    let split = initial;
    for (let step = 0; step < 1234; step += 1) split = advanceGame(split, 0.125);
    const whole = advanceGame(initial, 154.25);
    expect(split.equipmentCounts).toEqual(whole.equipmentCounts);
    expect(split.runEarnedScore).toBeCloseTo(whole.runEarnedScore, 6);
    expect(split.imo).toBeCloseTo(whole.imo, 6);
    const progress = advanceWithAutomation(initial, 154.25, true);
    const spent = progress.events.reduce((sum, event) => sum + getEquipmentPrice(event.id, event.state.equipmentCounts[event.id] - 1, initial.permanent), 0);
    expect(whole.runEarnedScore - whole.imo).toBeCloseTo(spent, 6);
    const restored = parseSave(serializeSave(createSave(split, 0))).gameState;
    expect(restored.automationRemainder).toEqual(split.automationRemainder);
    expect(advanceGame(restored, 60)).toEqual(advanceGame(split, 60));
  });

  it.each(Object.keys(AUTOMATION_POLICIES) as AutomationPolicy[])('matches stage1 partitioning and 24h offline for %s', (policy) => {
    const capable = purchaseSkill(prestigeGame(createBreakthroughReadyState()), 'automation');
    const expanded = performBreakthrough(advanceGame(capable, 1e6));
    const initial = configureAutomation(expanded, { ...expanded.automation, enabled: true, policy });
    Object.freeze(initial.automation.equipment); Object.freeze(initial.automation.priority); Object.freeze(initial.automation);
    Object.freeze(initial.equipmentCounts); Object.freeze(initial.permanent.skillRanks); Object.freeze(initial.permanent); Object.freeze(initial);
    const once = advanceGame(initial, 86_400);
    expect(settleOffline(createSave(initial, 0), 86_400_000).save.gameState).toEqual(once);
    for (const step of [0.25, 60, 43_200]) {
      let state = initial; let seconds = 0;
      while (seconds < 86_400 && state.runEarnedScore < 1e9) {
        const delta = Math.min(step, 86_400 - seconds); state = advanceGame(state, delta); seconds += delta;
      }
      state = advanceGame(state, 86_400 - seconds);
      expect(state.equipmentCounts).toEqual(once.equipmentCounts);
      expect(state.runEarnedScore).toBeCloseTo(once.runEarnedScore, 3);
      expect(state.imo).toBeCloseTo(once.imo, 3);
    }
    expect(once.permanent).toBe(initial.permanent);
    expect(once.scoreCapStage).toBe(1);
    expect(initial.runEarnedScore).toBe(1e6);
  });

  it('balances owned counts, includes milestone marginal gains, and uses stable tie order', () => {
    const base = { ...automated('balanced'), imo: 10_000, runEarnedScore: 10_000 };
    const balanced = advanceWithAutomation(base, 0, true);
    expect(balanced.events.slice(0, 3).map((event) => event.id)).toEqual(['worker', 'cart', 'harvester']);
    const counts = Object.values(balanced.state.equipmentCounts).slice(0, 3);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    const efficient = { ...automated(), imo: 100, runEarnedScore: 10_000,
      equipmentCounts: { ...createInitialState().equipmentCounts, worker: 9, cart: 4 },
      automation: { ...automated().automation, equipment: { veinExtractor: false, concentrator: false, worker: true, cart: true, harvester: false, deepDrill: false, refinery: false } } };
    expect(advanceWithAutomation(efficient, 0, true).events[0]?.id).toBe('worker');
  });

  it('honors explicit priority with fallback and equipment switches', () => {
    const initial = automated('priority');
    const state = { ...initial, imo: 100, runEarnedScore: 100,
      automation: { ...initial.automation, priority: ['harvester', 'cart', 'worker', 'refinery', 'deepDrill', 'veinExtractor', 'concentrator'] as const } };
    const progress = advanceWithAutomation(state, 0, true);
    expect(progress.events[0]?.id).toBe('cart');
    expect(progress.state.equipmentCounts.harvester).toBe(0);
    const onlyWorker = { ...state, automation: { ...state.automation,
      equipment: { veinExtractor: false, concentrator: false, worker: true, cart: false, harvester: false, deepDrill: false, refinery: false } } };
    expect(advanceGame(onlyWorker, 100).equipmentCounts.cart).toBe(0);
    const none = { ...onlyWorker, automation: { ...onlyWorker.automation, equipment: { ...onlyWorker.automation.equipment, worker: false } } };
    expect(advanceGame(none, 100).equipmentCounts).toEqual(none.equipmentCounts);
  });

  it.each([9, 24, 49])('uses the same cost and multiplier as manual purchasing around %s', (owned) => {
    const initial = automated();
    const state = { ...initial, runEarnedScore: 100_000, imo: getEquipmentPrice('worker', owned, initial.permanent),
      equipmentCounts: { ...initial.equipmentCounts, worker: owned },
      automation: { ...initial.automation, equipment: { veinExtractor: false, concentrator: false, worker: true, cart: false, harvester: false, deepDrill: false, refinery: false } } };
    const progress = advanceGame(state, 0);
    expect(progress).toEqual(purchaseEquipment(state, 'worker', 1));
    expect(progress.equipmentCounts.worker).toBe(owned + 1);
    expect(progress.imo).toBe(0);
  });

  it('stops before a simultaneous cap/purchase event and never breaks through by itself', () => {
    const initial = automated();
    const state = { ...initial, imo: 9, runEarnedScore: 999_999,
      automation: { ...initial.automation, equipment: { veinExtractor: false, concentrator: false, worker: true, cart: false, harvester: false, deepDrill: false, refinery: false } } };
    const progress = advanceWithAutomation(state, 86_400);
    expect(progress.state.runEarnedScore).toBe(1e6);
    expect(progress.state.imo).toBe(10);
    expect(progress.purchaseCount).toBe(0);
    expect(getPurchaseQuote(progress.state, 'worker', 'MAX').quantity).toBe(0);
    expect(advanceGame(progress.state, 86_400)).toBe(progress.state);
  });

  it('normalizes the first price boundary without violating the balance/SCORE constraint', () => {
    const state = automated();
    const almost = (10 - 4 * Number.EPSILON * 10) / getProductionPerSecond(state);
    const progressed = advanceGame(state, almost);
    expect(progressed.equipmentCounts.worker).toBe(1);
    expect(progressed.imo).toBe(0);
    expect(progressed.imo).toBeLessThanOrEqual(progressed.runEarnedScore);
    expect(() => createSave(progressed, 0)).not.toThrow();
    expect(() => advanceGame(progressed, 1)).not.toThrow();
  });

  it('ignores locked upper equipment and supports stage1 without a new cap', () => {
    const base = automated('priority');
    const upperOnly = { ...base.automation, equipment: { veinExtractor: false, concentrator: false, worker: false, cart: false, harvester: false, deepDrill: true, refinery: true } };
    expect(advanceGame({ ...base, automation: upperOnly }, 1e6).equipmentCounts.deepDrill).toBe(0);
    const capable = purchaseSkill(prestigeGame(createBreakthroughReadyState()), 'automation');
    const expanded = performBreakthrough(advanceGame(capable, 1e6));
    const state = { ...configureAutomation(expanded, { ...upperOnly, policy: 'efficient' }), imo: 50_000_000, runEarnedScore: 50_000_000 };
    const progress = advanceWithAutomation(state, 86_400);
    expect(progress.state.equipmentCounts.deepDrill).toBeGreaterThan(0);
    expect(progress.state.equipmentCounts.refinery).toBeGreaterThan(0);
    expect(progress.state.scoreCapStage).toBe(1);
    expect(progress.state.runEarnedScore).toBeLessThanOrEqual(1e9);
    expect(progress.purchaseCount).toBeLessThan(MAX_AUTOMATIC_PURCHASES);
    expect(getProductionPerSecond(progress.state)).toBeGreaterThan(getProductionPerSecond(state));
  });

  it('caps a 48h absence at 24h, reports purchases and does not settle twice', () => {
    const state = automated();
    const first = settleOffline(createSave(state, 0), 48 * 3_600_000);
    expect(first.save.gameState).toEqual(advanceGame(state, 86_400));
    expect(first.report.automaticPurchases).toBeGreaterThan(0);
    expect(first.report.appliedSeconds).toBe(86_400);
    const repeated = settleOffline(first.save, first.save.savedAt);
    expect(repeated.report.automaticPurchases).toBe(0);
    expect(repeated.save.gameState).toEqual(first.save.gameState);
    expect(parseSave(serializeSave(first.save))).toEqual(first.save);
  });

  it('makes the same purchase at a 24h affordability boundary after many fractional ticks', () => {
    const capable = purchaseSkill(prestigeGame(createBreakthroughReadyState()), 'automation');
    const expanded = performBreakthrough(advanceGame(capable, 1e6));
    let initial = configureAutomation(expanded, { ...expanded.automation, enabled: true,
      equipment: { veinExtractor: false, concentrator: false, worker: false, cart: false, harvester: false, deepDrill: false, refinery: true } });
    initial = { ...initial, runEarnedScore: 20_000_000, equipmentCounts: { ...initial.equipmentCounts, worker: 11 } };
    const price = getEquipmentPrice('refinery', 0, initial.permanent);
    initial = { ...initial, imo: price - getProductionPerSecond(initial) * 86_400 };
    const whole = advanceGame(initial, 86_400);
    let split = initial;
    const steps = Math.floor(86_400 / 0.37);
    for (let index = 0; index < steps; index += 1) split = advanceGame(split, 0.37);
    split = advanceGame(split, 86_400 - steps * 0.37);
    expect(split.equipmentCounts).toEqual(whole.equipmentCounts);
    expect(split.imo).toBeCloseTo(whole.imo, 3);
    expect(split.runEarnedScore).toBeCloseTo(whole.runEarnedScore, 3);
  }, 15_000);
});

describe('automation save validation', () => {
  it.each([1, 2, 3, 4])('preserves legacy v%s state and defaults automation OFF', (version) => {
    const state = { ...createBreakthroughReadyState(), imo: 123.5 };
    const { automation: _settings, ...legacy } = state;
    const { automation: _skill, ...ranks } = legacy.permanent.skillRanks;
    const saved = { ...legacy, ...(version < 4 ? { scoreCapStage: 0,
      permanent: { ...legacy.permanent, unspentPoints: 3, skillRanks: { ...ranks, breakthrough: 0 } } } : { permanent: { ...legacy.permanent, skillRanks: ranks } }) };
    const migrated = parseSave(JSON.stringify({ saveVersion: version, savedAt: 1234, gameState: saved }));
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    expect(migrated.gameState.imo).toBe(123.5);
    expect(migrated.gameState.equipmentCounts).toEqual(state.equipmentCounts);
    expect(migrated.gameState.automation).toEqual(createDefaultAutomation());
    expect(migrated.gameState.permanent.skillRanks.automation).toBe(0);
    if (version === 4) expect(migrated.gameState.permanent.skillRanks.breakthrough).toBe(1);
  });

  it.each([
    null, {}, { ...createDefaultAutomation(), enabled: 'true' }, { ...createDefaultAutomation(), policy: 'unknown' },
    { ...createDefaultAutomation(), equipment: { veinExtractor: false, concentrator: false, worker: true } }, { ...createDefaultAutomation(), priority: ['worker'] },
    { ...createDefaultAutomation(), priority: ['worker', 'worker', 'harvester', 'deepDrill', 'refinery'] },
    { ...createDefaultAutomation(), priority: ['worker', 'cart', 'harvester', 'deepDrill', 'unknown'] },
  ])('rejects malformed settings without migration fallback %#', (settings) => {
    expect(() => readAutomation(settings)).toThrow();
    expect(() => parseSave(JSON.stringify({ saveVersion: 5, savedAt: 0, gameState: { ...automated(), automation: settings } }))).toThrow();
  });

  it('rejects active automation without permission and a missing v5 rank', () => {
    expect(() => createSave({ ...createInitialState(), automation: { ...createDefaultAutomation(), enabled: true } }, 0)).toThrow();
    const state = automated();
    const { automation: _rank, ...ranks } = state.permanent.skillRanks;
    expect(() => parseSave(JSON.stringify({ saveVersion: 5, savedAt: 0, gameState: { ...state, permanent: { ...state.permanent, skillRanks: ranks } } }))).toThrow();
  });

  it.each([null, { score: 1, imo: 0 }, { score: 0, imo: Infinity }, { score: '0', imo: 0 }])('rejects malformed numeric carry %#', (automationRemainder) => {
    expect(() => parseSave(JSON.stringify({ saveVersion: 5, savedAt: 0, gameState: { ...automated(), automationRemainder } }))).toThrow();
  });
});
