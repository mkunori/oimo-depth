import { describe, expect, it } from 'vitest';
import { formatMultiplier, formatNumber } from './formatNumber';

describe('number display', () => {
  it.each([1, 1.1, 1.265, 1.58125])('preserves milestone multiplier precision for %s', (value) => {
    expect(formatMultiplier(value)).toBe(String(value));
  });
  it.each([
    [0, '0'],
    [9.999, '9.9'],
    [1_000.25, '1,000.2'],
    [999_999.999, '999,999.9'],
    [1_000_000, '1,000,000'],
    [1e9, '1E9'],
    [1.234e12, '1.23E12'],
  ])('formats %s as %s without rounding to an unreached balance', (value, expected) => {
    expect(formatNumber(value)).toBe(expected);
  });
});
