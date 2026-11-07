import { expect } from 'vitest';
import { GameNumber, gn } from '../core/numbers';
import type { GameNumberInput } from '../core/numbers';

expect.addEqualityTesters([function (a, b) {
  if (a instanceof GameNumber || b instanceof GameNumber) return a instanceof GameNumber && b instanceof GameNumber && a.equals(b);
}]);
const result = (pass: boolean, actual: GameNumberInput, expected: GameNumberInput) => ({ pass,
  message: () => `amount ${String(actual)} vs ${String(expected)}` });
expect.extend({
  toBeAmount(actual: GameNumberInput, expected: GameNumberInput) { return result(gn(actual).equals(expected), actual, expected); },
  toEqualAmount(actual: GameNumberInput, expected: GameNumberInput) { return result(gn(actual).equals(expected), actual, expected); },
  toBeCloseToAmount(actual: GameNumberInput, expected: GameNumberInput, digits = 2) { return result(gn(actual).subtract(expected).abs().lt(0.5 * 10 ** -digits), actual, expected); },
  toBeLessThanAmount(actual: GameNumberInput, expected: GameNumberInput) { return result(gn(actual).lt(expected), actual, expected); },
  toBeLessThanOrEqualAmount(actual: GameNumberInput, expected: GameNumberInput) { return result(gn(actual).lte(expected), actual, expected); },
  toBeGreaterThanAmount(actual: GameNumberInput, expected: GameNumberInput) { return result(gn(actual).gt(expected), actual, expected); },
  toBeGreaterThanOrEqualAmount(actual: GameNumberInput, expected: GameNumberInput) { return result(gn(actual).gte(expected), actual, expected); },
});

declare module 'vitest' {
  interface Assertion<R extends void | Promise<void> = void, T = unknown> {
    toBeAmount(this: Assertion<R, T>, expected: GameNumberInput): R;
    toEqualAmount(expected: GameNumberInput): R;
    toBeCloseToAmount(expected: GameNumberInput, digits?: number): R;
    toBeLessThanAmount(expected: GameNumberInput): R;
    toBeLessThanOrEqualAmount(expected: GameNumberInput): R;
    toBeGreaterThanAmount(expected: GameNumberInput): R;
    toBeGreaterThanOrEqualAmount(expected: GameNumberInput): R;
  }
}
