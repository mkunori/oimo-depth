import { describe, expect, it } from 'vitest';
import { INITIAL_BALANCE } from '../data/balance';
import { EQUIPMENT_IDS } from '../data/equipment';
import type { EquipmentId } from '../data/equipment';
import {
  advanceGame,
  getAffordableQuantity,
  getEquipmentPrice,
  getProductionPerSecond,
  getPurchaseQuote,
  purchaseEquipment,
} from './game';
import type { PurchaseMode } from './game';
import { createInitialState } from './state';
import type { GameState } from './state';

const SCORE_CAP = INITIAL_BALANCE.scoreCap;
const HARVEST_TOLERANCE = 1e-8;

function fundedState(imo: number): GameState {
  return { ...createInitialState(), imo, runEarnedScore: imo };
}

function freezeState(state: GameState): GameState {
  return Object.freeze({
    ...state,
    equipmentCounts: Object.freeze({ ...state.equipmentCounts }),
  });
}

describe('advanceGame', () => {
  it('harvests fractional seconds without rounding to whole imo', () => {
    const state = advanceGame(createInitialState(), 0.125);

    expect(state.imo).toBe(0.125);
    expect(state.runEarnedScore).toBe(0.125);
  });

  it('adds the production of all owned equipment', () => {
    const state: GameState = {
      ...createInitialState(),
      equipmentCounts: { worker: 2, cart: 3, harvester: 4 },
    };

    expect(getProductionPerSecond(state)).toBe(433);
    expect(advanceGame(state, 2).imo).toBe(866);
  });

  it.each([0.1, 1, 123.4567, 1_000, 1e6])(
    'matches one advance with 100 fractional advances totaling %s seconds',
    (elapsed) => {
      const initial = purchaseEquipment(fundedState(20_000), 'cart', 10);
      const once = advanceGame(initial, elapsed);
      let split = initial;
      for (let index = 0; index < 100; index += 1) {
        split = advanceGame(split, elapsed / 100);
      }

      expect(Math.abs(split.imo - once.imo)).toBeLessThanOrEqual(HARVEST_TOLERANCE);
      expect(Math.abs(split.runEarnedScore - once.runEarnedScore))
        .toBeLessThanOrEqual(HARVEST_TOLERANCE);
      expect(split.equipmentCounts).toEqual(once.equipmentCounts);
    },
  );

  it('clips excess harvest and preserves previously spent imo at the cap', () => {
    const before: GameState = {
      ...fundedState(SCORE_CAP - 1),
      imo: 123,
      equipmentCounts: { worker: 10, cart: 10, harvester: 10 },
    };
    const after = advanceGame(before, Number.MAX_VALUE);

    expect(after.runEarnedScore).toBe(SCORE_CAP);
    expect(after.imo).toBe(124);
    expect(after.runEarnedScore - after.imo).toBe(before.runEarnedScore - before.imo);
    expect(advanceGame(after, 1_000)).toBe(after);
  });

  it('stops exactly at the cap and does not restart after buying equipment', () => {
    const capped = advanceGame(createInitialState(), SCORE_CAP);
    const purchased = purchaseEquipment(capped, 'worker', 1);

    expect(capped.imo).toBe(SCORE_CAP);
    expect(purchased.imo).toBe(SCORE_CAP - 10);
    expect(purchased.runEarnedScore).toBe(SCORE_CAP);
    expect(getProductionPerSecond(purchased)).toBe(2);
    expect(advanceGame(purchased, 100)).toBe(purchased);
  });

  it('returns the same state for zero time', () => {
    const state = createInitialState();
    expect(advanceGame(state, 0)).toBe(state);
  });

  it.each([-1, -Number.MIN_VALUE, NaN, Infinity, -Infinity])(
    'rejects invalid elapsed time %s without mutating the state',
    (elapsed) => {
      const state = freezeState(fundedState(100));

      expect(() => advanceGame(state, elapsed)).toThrow(RangeError);
      expect(state).toEqual(fundedState(100));
    },
  );

  it('validates time even when the game is already capped', () => {
    expect(() => advanceGame(fundedState(SCORE_CAP), NaN)).toThrow(RangeError);
  });

  it('does not mutate a frozen input or its equipment counts', () => {
    const state = freezeState(fundedState(20));
    const next = advanceGame(state, 10);

    expect(next.imo).toBe(30);
    expect(state).toEqual(fundedState(20));
  });
});

describe('equipment prices and purchases', () => {
  it.each([
    ['worker', 10, 12, 1],
    ['cart', 100, 120, 10],
    ['harvester', 1_000, 1_250, 100],
  ] as const)('uses the provisional prices and production for %s', (id, price, nextPrice, rate) => {
    const initial = freezeState(fundedState(price));
    const purchased = purchaseEquipment(initial, id, 1);

    expect(getEquipmentPrice(id, 0)).toBe(price);
    expect(getEquipmentPrice(id, 1)).toBe(nextPrice);
    expect(purchased.imo).toBe(0);
    expect(purchased.runEarnedScore).toBe(price);
    expect(purchased.equipmentCounts[id]).toBe(1);
    expect(getProductionPerSecond(purchased)).toBe(1 + rate);
    expect(initial.equipmentCounts[id]).toBe(0);
  });

  it('rounds each price upward before summing, including an exact budget boundary', () => {
    const state = fundedState(209);

    expect(getPurchaseQuote(state, 'worker', 10)).toEqual({ quantity: 10, totalCost: 209 });
    expect(getPurchaseQuote(fundedState(208), 'worker', 10))
      .toEqual({ quantity: 9, totalCost: 173 });
    expect(getEquipmentPrice('worker', 10)).toBe(41);
    expect(purchaseEquipment(state, 'worker', 10).imo).toBe(0);
  });

  it('buys fewer than ten when the remaining units are unaffordable', () => {
    const state = fundedState(100);

    expect(getPurchaseQuote(state, 'worker', 10)).toEqual({ quantity: 6, totalCost: 91 });
    expect(getAffordableQuantity(state, 'worker')).toBe(6);
    expect(purchaseEquipment(state, 'worker', 10)).toEqual({
      imo: 9,
      runEarnedScore: 100,
      equipmentCounts: { worker: 6, cart: 0, harvester: 0 },
    });
  });

  it.each([1, 10, 'MAX'] as const)('leaves state unchanged when mode %s cannot buy a unit', (mode) => {
    const state = freezeState(fundedState(9.999));

    expect(getPurchaseQuote(state, 'worker', mode)).toEqual({ quantity: 0, totalCost: 0 });
    expect(getAffordableQuantity(state, 'worker')).toBe(0);
    expect(purchaseEquipment(state, 'worker', mode)).toBe(state);
  });

  it.each(EQUIPMENT_IDS)('makes batch and individual purchases identical for %s', (id) => {
    for (const budget of [0, 10, 100, 209, 1_000.5, 50_000, SCORE_CAP]) {
      for (const alreadyOwned of [0, 3, 10]) {
        const initial = freezeState({
          ...fundedState(budget),
          equipmentCounts: { worker: 0, cart: 0, harvester: 0, [id]: alreadyOwned },
        });
        for (const mode of [1, 10, 'MAX'] as const) {
          const quote = getPurchaseQuote(initial, id, mode);
          const batch = purchaseEquipment(initial, id, mode);
          let individual = initial;
          for (let index = 0; index < quote.quantity; index += 1) {
            individual = purchaseEquipment(individual, id, 1);
          }

          expect(batch).toEqual(individual);
          expect(batch.imo).toBe(budget - quote.totalCost);
          expect(batch.runEarnedScore).toBe(initial.runEarnedScore);
          expect(batch.equipmentCounts[id]).toBe(alreadyOwned + quote.quantity);
          expect(batch.imo).toBeGreaterThanOrEqual(0);
          if (mode === 'MAX') {
            expect(getAffordableQuantity(initial, id)).toBe(quote.quantity);
            expect(purchaseEquipment(batch, id, 1)).toBe(batch);
          }
        }
      }
    }
  });

  it('preserves the spent-imo ledger across purchases and subsequent harvests', () => {
    let state = advanceGame(createInitialState(), 50_000);
    let spent = 0;
    for (const id of EQUIPMENT_IDS) {
      const quote = getPurchaseQuote(state, id, 10);
      spent += quote.totalCost;
      state = purchaseEquipment(state, id, 10);
      state = advanceGame(state, 0.25);
      expect(Math.abs(state.runEarnedScore - state.imo - spent))
        .toBeLessThanOrEqual(HARVEST_TOLERANCE);
    }
    const capped = advanceGame(state, Number.MAX_VALUE);
    expect(capped.runEarnedScore).toBe(SCORE_CAP);
    expect(capped.imo).toBe(SCORE_CAP - spent);
  });

  it.each([0, -1, 2, 11, 1.5, NaN, Infinity, 'max', undefined])(
    'rejects invalid purchase mode %s without changing state',
    (mode) => {
      const state = freezeState(fundedState(100));

      expect(() => getPurchaseQuote(state, 'worker', mode as PurchaseMode)).toThrow(RangeError);
      expect(() => purchaseEquipment(state, 'worker', mode as PurchaseMode)).toThrow(RangeError);
      expect(state).toEqual(fundedState(100));
    },
  );

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid owned count %s when calculating prices',
    (count) => {
      expect(() => getEquipmentPrice('worker', count)).toThrow(RangeError);
    },
  );

  it('rejects price overflow instead of returning Infinity or an unsafe integer', () => {
    expect(() => getEquipmentPrice('worker', 1_000)).toThrow(RangeError);
    expect(() => getEquipmentPrice('worker', Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  it.each(['unknown', '__proto__', 'toString'])('rejects unknown equipment ID %s', (id) => {
    const state = createInitialState();

    expect(() => getEquipmentPrice(id as EquipmentId, 0)).toThrow(RangeError);
    expect(() => getPurchaseQuote(state, id as EquipmentId, 1)).toThrow(RangeError);
    expect(() => purchaseEquipment(state, id as EquipmentId, 1)).toThrow(RangeError);
  });
});

describe('state validation', () => {
  const invalidStates: GameState[] = [
    ...[-1, NaN, Infinity].map((imo) => ({ ...fundedState(100), imo })),
    ...[-1, NaN, Infinity, SCORE_CAP + 1].map((runEarnedScore) => ({
      ...fundedState(0), runEarnedScore,
    })),
    { ...fundedState(100), imo: 101 },
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((worker) => ({
      ...fundedState(100), equipmentCounts: { worker, cart: 0, harvester: 0 },
    })),
  ];

  it.each(invalidStates)('rejects malformed numeric state %# before processing it', (invalid) => {
    const state = freezeState(invalid);

    expect(() => getProductionPerSecond(state)).toThrow(RangeError);
    expect(() => advanceGame(state, 0)).toThrow(RangeError);
    expect(() => getPurchaseQuote(state, 'worker', 1)).toThrow(RangeError);
    expect(() => getAffordableQuantity(state, 'worker')).toThrow(RangeError);
    expect(() => purchaseEquipment(state, 'worker', 1)).toThrow(RangeError);
    expect(state).toEqual(invalid);
  });
});
