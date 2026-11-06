import { describe, expect, it } from 'vitest';
import {
  advanceGame, getEquipmentAvailability, getEquipmentMilestones, getEquipmentPrice, getEquipmentPurchaseGain,
  getProductionPerSecond, getPurchaseQuote, purchaseEquipment,
} from './game';
import { createInitialState } from './state';
import { createSave, parseSave, SAVE_VERSION, serializeSave, settleOffline } from './save';
import { prestigeGame, purchaseSkill } from './prestige';
import { EQUIPMENT_IDS, INITIAL_EQUIPMENT_IDS } from '../data/equipment';
import { createBreakthroughReadyState } from '../test/progress';
import { performBreakthrough } from './breakthrough';

describe('equipment milestones', () => {
  it.each(INITIAL_EQUIPMENT_IDS)('applies cumulative bonuses at exactly 10/25/50 for %s', (id) => {
    for (const [count, multiplier] of [[9, 1], [10, 1.1], [24, 1.1], [25, 1.265], [49, 1.265], [50, 1.58125]]) {
      const state = { ...createInitialState(), equipmentCounts: { ...createInitialState().equipmentCounts, [id]: count! } };
      const actual = getEquipmentMilestones(id, count!);
      expect(actual.multiplier).toBeCloseTo(multiplier!, 8);
      const unit = id === 'worker' ? 1 : id === 'cart' ? 10 : 100;
      expect(getProductionPerSecond(state)).toBeCloseTo(1 + count! * unit * multiplier!, 8);
      expect(actual.next?.count ?? null).toBe(count! < 10 ? 10 : count! < 25 ? 25 : count! < 50 ? 50 : null);
    }
  });

  it('applies a bonus to that equipment only, including previously owned units', () => {
    const state = { ...createInitialState(), equipmentCounts: { ...createInitialState().equipmentCounts, worker: 10, cart: 1 } };
    expect(getProductionPerSecond(state)).toBe(22);
    expect(getEquipmentPurchaseGain('worker', 9, state.permanent)).toBeCloseTo(2, 8);
    expect(getEquipmentPurchaseGain('worker', 24, state.permanent)).toBeCloseTo(5.225, 8);
  });

  it('uses the same milestone/skill rate online and offline without stored multiplier flags', () => {
    const skilled = purchaseSkill(prestigeGame(advanceGame(createInitialState(), 1_000_000)), 'harvest');
    const state = { ...skilled, equipmentCounts: { ...skilled.equipmentCounts, harvester: 25 } };
    expect(getProductionPerSecond(state)).toBeCloseTo((1 + 25 * 100 * 1.265) * 1.5, 8);
    const offline = settleOffline(createSave(state, 0), 60_000);
    expect(offline.report.earnedImo).toBeCloseTo(getProductionPerSecond(state) * 60, 8);
    expect(offline.save.gameState).toEqual(advanceGame(state, 60));
    expect(parseSave(serializeSave(createSave(state, 0))).gameState).toEqual(state);
  });

  it.each(EQUIPMENT_IDS)('keeps individual and bulk cost/count/effects identical for %s', (id) => {
    for (const count of [0, 9, 24, 49]) {
      const state = { ...performBreakthrough(createBreakthroughReadyState()), imo: 1e9 - 1, runEarnedScore: 1e9 - 1,
        equipmentCounts: { ...createInitialState().equipmentCounts, [id]: count } };
      for (const mode of [1, 10, 'MAX'] as const) {
        const quote = getPurchaseQuote(state, id, mode);
        let individual = state;
        for (let index = 0; index < quote.quantity; index += 1) individual = purchaseEquipment(individual, id, 1);
        const batch = purchaseEquipment(state, id, mode);
        expect(batch).toEqual(individual);
        expect(state.imo - batch.imo).toBe(quote.totalCost);
        expect(getProductionPerSecond(batch)).toBe(getProductionPerSecond(individual));
      }
    }
  });

  it.each([-1, 0.5, NaN, Infinity])('rejects malformed ownership %s', (count) => {
    expect(() => getEquipmentMilestones('worker', count)).toThrow(RangeError);
  });
});

describe('higher equipment stays locked in the actual initial game', () => {
  it.each(['deepDrill', 'refinery'] as const)('rejects %s regardless of purchase mode or current SCORE', (id) => {
    const state = advanceGame(createInitialState(), 1_000_000);
    expect(getEquipmentAvailability(id)).toEqual({ unlocked: false, requiredScoreCap: 1e9 });
    for (const mode of [1, 10, 'MAX'] as const) {
      expect(getPurchaseQuote(state, id, mode)).toEqual({ quantity: 0, totalCost: 0 });
      expect(purchaseEquipment(state, id, mode)).toBe(state);
    }
    const funded = advanceGame(performBreakthrough(createBreakthroughReadyState()), 10_000_000);
    expect(getEquipmentAvailability(id, funded).unlocked).toBe(true);
    const bought = purchaseEquipment(funded, id, 1);
    expect(bought.equipmentCounts[id]).toBe(1);
    expect(bought.imo).toBe(funded.imo - getEquipmentPrice(id, 0, funded.permanent));
    expect(() => getPurchaseQuote({ ...funded, scoreCapStage: 0 }, id, 1)).toThrow(RangeError);
  });

  it('rejects advanced ownership and forged stages in actual saves', () => {
    const state = { ...createInitialState(), equipmentCounts: { ...createInitialState().equipmentCounts, deepDrill: 1 } };
    expect(() => getProductionPerSecond(state)).toThrow(RangeError);
    expect(() => createSave(state, 0)).toThrow();
    expect(() => parseSave(JSON.stringify({ saveVersion: SAVE_VERSION, savedAt: 0,
      gameState: { ...state, scoreCap: 1e9, runEarnedScore: 1e9, imo: 1e9 } }))).toThrow();
    expect(advanceGame(advanceGame(createInitialState(), 1_000_000), 1_000_000).runEarnedScore).toBe(1e6);
  });
});

describe('equipment ID migration', () => {
  it.each([1, 2])('preserves an actual v%s save and fills only new zero counts', (version) => {
    const initial = createInitialState();
    const progressed = purchaseSkill(prestigeGame(advanceGame(initial, 1e6)), 'harvest');
    const oldState = { imo: 12.5, runEarnedScore: 500, equipmentCounts: { worker: 10, cart: 2, harvester: 1 },
      ...(version === 2 ? { runStartingImo: 0, permanent: progressed.permanent } : {}) };
    const parsed = parseSave(JSON.stringify({ saveVersion: version, savedAt: 1234, gameState: oldState }));
    expect(parsed.saveVersion).toBe(SAVE_VERSION);
    expect(parsed.savedAt).toBe(1234);
    expect(parsed.gameState.imo).toBe(12.5);
    expect(parsed.gameState.runEarnedScore).toBe(500);
    expect(parsed.gameState.equipmentCounts).toEqual({ ...initial.equipmentCounts, ...oldState.equipmentCounts });
    expect(parsed.gameState.permanent).toEqual(version === 2 ? progressed.permanent : initial.permanent);
    expect(parsed.gameState.equipmentCounts.deepDrill).toBe(0);
    expect(parsed.gameState.equipmentCounts.refinery).toBe(0);
    expect(parseSave(serializeSave(parsed))).toEqual(parsed);
  });

  it('rejects incomplete v3 data without downgrading to legacy', () => {
    expect(() => parseSave(JSON.stringify({ saveVersion: 3, savedAt: 0,
      gameState: { ...createInitialState(), equipmentCounts: { worker: 0, cart: 0, harvester: 0 } } }))).toThrow();
  });
});
