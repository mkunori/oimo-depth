import { describe, expect, it } from 'vitest';
import { approximatelyEqual, formatScoreProgress, GameNumber, isValidGameNumberInput, MAX_NUMBER_TEXT_LENGTH, nonNegativeGameNumber, readGameNumber, toElapsedSeconds } from './numbers';

const n = GameNumber.from;
const magnitudes = ['0', '1', '1e6', '1e12', '1e15', '1e30', '1e100', '1e1000', '0.125', '1e-30', '1e-1000'];

describe('GameNumber construction and normalization', () => {
  it.each(magnitudes)('accepts %s without NaN/Infinity and round trips the exact normalized representation', (input) => {
    const value = n(input);
    expect(isValidGameNumberInput(value)).toBe(true);
    expect(value.compare(0)).toBeGreaterThanOrEqual(0);
    expect(n(value.toString()).toString()).toBe(value.toString());
    expect(n(value)).toBe(value);
    expect(value.add(0).toString()).toBe(value.toString());
    expect(value.multiply(1).toString()).toBe(value.toString());
    expect(value.subtract(value).isZero()).toBe(true);
  });

  it.each(['0', '-0', '+0', '00.00', '-0e1000', '0e-1000'])('normalizes signed or scaled zero %s', (input) => {
    const zero = n(input);
    expect(zero.sign).toBe(0);
    expect(zero.toString()).toBe('gn1:0:0:0');
    expect(zero.format()).toBe('0');
    expect(zero.toFiniteNumber()).toBe(0);
  });

  it('accepts only numbers, strict decimal strings and our opaque values at an unknown boundary', () => {
    expect(readGameNumber(12.5).equals('1.25e1')).toBe(true);
    expect(n('.5').equals('0.50')).toBe(true);
    expect(n('1.').equals('+1E0')).toBe(true);
    expect(n('000100.00').equals(100)).toBe(true);
    expect(n(Number.MIN_VALUE).sign).toBe(1);
    expect(n(Number.MIN_VALUE).toFiniteNumber()).toBe(Number.MIN_VALUE);
    expect(n(Number.MAX_VALUE).compare('1e1000')).toBe(-1);
  });

  it.each([
    undefined, null, true, false, {}, [], { sign: 1, layer: 1, mag: 1000 }, { value: 1 }, 1n,
    NaN, Infinity, -Infinity, '', ' ', '\n1', '1\n', '1\r\n', '1 ', ' 1', 'NaN', 'Infinity', '-Infinity',
    '1,000', '1_000', '0xff', '0b10', '12abc', '1e', '1e1.5', '1eInfinity', '1e9007199254740992',
    '1e-9007199254740992', '1e9999999999999999999999999999999999999999999999999999999999',
    'ee10', '10^^3', '2^3', '(e^2)20', '1e2e3', '1/2', '--1', '++1', '１', '1\u0000',
    'gn1:0:1:1000', 'gn1:1:0:0', 'gn1:1:0:-1', 'gn1:1:1:1', 'gn1:1:-1:10', 'gn1:1:1.5:20',
    'gn1:1:2:Infinity', 'gn1:1:2:NaN', 'gn1:1:9007199254740992:20', 'gn1:1:2:20.0', 'gn1:1:02:20',
    'gn1:1:2:20\n', 'gn2:1:2:20', '1'.repeat(MAX_NUMBER_TEXT_LENGTH + 1), Object.create(GameNumber.prototype),
  ])('rejects malformed external input %#', (input) => {
    expect(isValidGameNumberInput(input)).toBe(false);
    expect(() => readGameNumber(input)).toThrow();
  });

  it('keeps representation private and immutable, and rejects implicit numeric or JSON use', () => {
    const original = n('1e1000');
    expect(Object.isFrozen(original)).toBe(true);
    expect(Object.keys(original)).toEqual([]);
    const result = original.multiply(2);
    expect(result.compare(original)).toBe(1);
    expect(original.equals('1e1000')).toBe(true);
    expect(String(original)).toBe(original.toString());
    expect(() => Number(original)).toThrow(TypeError);
    expect(() => JSON.stringify({ value: original })).toThrow(TypeError);
  });
});

describe('GameNumber arithmetic and strict order', () => {
  it.each(magnitudes.filter((x) => x !== '0'))('computes arithmetic near %s with documented approximate precision', (input) => {
    const value = n(input);
    expect(approximatelyEqual(value.multiply(2).divide(2), value, 0)).toBe(true);
    expect(approximatelyEqual(value.pow(2).divide(value), value, 0)).toBe(true);
    expect(approximatelyEqual(value.add(value).subtract(value), value, 0)).toBe(true);
    expect(value.divide(value).equals(1)).toBe(true);
  });

  it('orders huge/tiny/signed amounts without converting them to native numbers', () => {
    const ordered = ['-1e1000', '-1e30', '-1', '-1e-1000', '0', '1e-1000', '1e-30', '1', '1e6', '1e12', '1e15', '1e30', '1e100', '1e1000'];
    for (let i = 1; i < ordered.length; i += 1) {
      const a = n(ordered[i - 1]!), b = n(ordered[i]!);
      expect(a.compare(b)).toBe(-1);
      expect(b.compare(a)).toBe(1);
      expect(a.min(b)).toBe(a);
      expect(a.max(b)).toBe(b);
    }
    expect(n('-1e1000').negate().equals('1e1000')).toBe(true);
    expect(n('-1e1000').abs().equals('1e1000')).toBe(true);
    expect(n(1).subtract(2).equals(-1)).toBe(true);
    expect(() => nonNegativeGameNumber(-1)).toThrow(RangeError);
    expect(nonNegativeGameNumber(0).isZero()).toBe(true);
  });

  it('rounds represented prices upward without tolerance or affordability credit', () => {
    expect(n('12.0000000001').ceil().equals(13)).toBe(true);
    expect(n('0.0000000001').ceil().equals(1)).toBe(true);
    expect(n('1e-1000').ceil().equals(1)).toBe(true);
    expect(n('-0.125').ceil().equals(0)).toBe(true);
    expect(n('-12.125').ceil().equals(-12)).toBe(true);
    expect(n('-12.125').floor().equals(-13)).toBe(true);
    expect(n('1e1000').ceil().equals('1e1000')).toBe(true);
    const balance = n('99.9999999999');
    expect(approximatelyEqual(balance, 100)).toBe(true);
    expect(balance.compare(100)).toBe(-1);
    expect(n('999999999999').compare('1e12')).toBe(-1);
    expect(n('999999999999999').compare('1e15')).toBe(-1);
  });

  it('retains layered results and documents where unit precision is lost', () => {
    const layered = n('1e1000').pow('1e1000');
    expect(layered.compare('1e1000')).toBe(1);
    expect(layered.toString()).toMatch(/^gn1:1:2:/);
    expect(n(layered.toString()).toString()).toBe(layered.toString());
    const tiny = n(1).divide(layered);
    expect(tiny.sign).toBe(1);
    expect(tiny.compare('1e-1000')).toBe(-1);
    expect(n(tiny.toString()).toString()).toBe(tiny.toString());
    expect(n('1e30').add(1).equals('1e30')).toBe(true);
    expect(n('1e30').add(1).subtract('1e30').isZero()).toBe(true);
    expect(n(0).pow(0).equals(1)).toBe(true);
    expect(n(-2).pow(3).sign).toBe(-1);
    expect(approximatelyEqual(n(-2).pow(3), -8)).toBe(true);
  });

  it('rejects undefined/infinite arithmetic and invalid tolerance options', () => {
    expect(() => n(1).divide(0)).toThrow(RangeError);
    expect(() => n(0).divide(0)).toThrow(RangeError);
    expect(() => n(0).pow(-1)).toThrow(RangeError);
    expect(() => n(-1).pow(0.5)).toThrow(RangeError);
    expect(() => n(-1).pow('1e1000')).toThrow(RangeError);
    for (const tolerance of [-1, NaN, Infinity]) {
      expect(() => approximatelyEqual(1, 1, tolerance)).toThrow(RangeError);
      expect(() => approximatelyEqual(1, 1, 0, tolerance)).toThrow(RangeError);
    }
    expect(() => approximatelyEqual(1, 1, 0, 2)).toThrow(RangeError);
    expect(approximatelyEqual('1e1000', '1.0000000000001e1000', 0)).toBe(true);
    expect(approximatelyEqual('1e1000', '1.01e1000', 0)).toBe(false);
  });

  it('does not let a relative tolerance collapse into the entire layered amount', () => {
    const huge = n('gn1:1:2:1000');
    expect(approximatelyEqual(huge, 1, 0)).toBe(false);
    expect(approximatelyEqual(huge, 'gn1:1:2:999', 0)).toBe(false);
    expect(approximatelyEqual(huge, huge.negate(), 0, 1)).toBe(false);
    expect(approximatelyEqual(huge, 0, 0, 1)).toBe(true);
    expect(approximatelyEqual(-1, 1, 0, 1)).toBe(false);
    expect(approximatelyEqual(-1, 1, 2, 0)).toBe(true);
    expect(approximatelyEqual('1.0001', 1, 0, 0)).toBe(false);
  });
});

describe('number display and conversion boundaries', () => {
  it.each([
    ['0', '0'], ['1', '1'], ['1234', '1,230'], ['1234567', '1,230,000'], ['0.125', '0.125'],
    ['1e6', '1,000,000'], ['1e12', '1E12'], ['1e15', '1E15'], ['1e30', '1E30'],
    ['1e100', '1E100'], ['1e1000', '1E1000'], ['1e-1000', '1E-1000'], ['-1e1000', '-1E1000'],
  ])('formats %s as %s separately from serialization', (input, display) => {
    expect(n(input).format()).toBe(display);
  });

  it('does not display a cap as reached by rounding a smaller represented amount upward', () => {
    for (const capText of ['1', '1e6', '1e12', '1e15', '1e30', '1e100', '1e1000']) {
      const cap = n(capText);
      const below = cap.multiply('0.99999');
      expect(below.compare(cap)).toBe(-1);
      expect(below.format()).not.toBe(cap.format());
      const displayed = below.format().replaceAll(',', '');
      if (!displayed.startsWith('<')) expect(n(displayed).compare(cap)).toBe(-1);
    }
    expect(n('999.9999').format()).toBe('999');
    expect(n('999999999999').format()).toBe('9.99E11');
    expect(n('0.000012345').format()).toBe('1.23E-5');
    for (const digits of [0, 16, 1.5, NaN, Infinity]) expect(() => n(1).format(digits)).toThrow(RangeError);
  });

  it('formats higher layers and their reciprocals without native-number overflow', () => {
    expect(n('gn1:1:2:20').format()).toBe('ee20');
    expect(n('gn1:-1:3:20').format()).toBe('-eee20');
    expect(n('gn1:1:4:20').format()).toBe('(e^4)20');
    expect(n('gn1:1:2:-20').format()).toBe('ee-20');
    expect(n('gn1:1:2:-20.123').format()).toBe('ee-20.2');
  });

  it('marks an unreached SCORE even when both truncated labels would otherwise be identical', () => {
    expect(formatScoreProgress('1233.9999', 1234)).toEqual({ score: '1,230（未到達）', cap: '1,230', reached: false });
    expect(formatScoreProgress('1.23455e1000', '1.23456e1000')).toEqual({ score: '1.23E1000（未到達）', cap: '1.23E1000', reached: false });
    expect(formatScoreProgress('999999999999', '1e12')).toEqual({ score: '9.99E11', cap: '1E12', reached: false });
    expect(formatScoreProgress('1e1000', '1e1000')).toEqual({ score: '1E1000', cap: '1E1000', reached: true });
    expect(() => formatScoreProgress(0, 0)).toThrow(RangeError);
    expect(() => formatScoreProgress(-1, 1)).toThrow(RangeError);
  });

  it('makes native conversion explicit and rejects underflow as well as overflow', () => {
    expect(n('1e12').toFiniteNumber()).toBe(1e12);
    expect(() => n('1e1000').toFiniteNumber()).toThrow(RangeError);
    expect(() => n('1e-1000').toFiniteNumber()).toThrow(RangeError);
    expect(() => n('-1e1000').toFiniteNumber()).toThrow(RangeError);
  });

  it('converts amount/rate to time only inside a finite horizon', () => {
    expect(toElapsedSeconds('1e1000', '1e1000', 86400)).toEqual({ kind: 'within-horizon', seconds: 1 });
    expect(toElapsedSeconds('1e-1000', '1e-1000', 1)).toEqual({ kind: 'within-horizon', seconds: 1 });
    expect(toElapsedSeconds(1, 4, 1)).toEqual({ kind: 'within-horizon', seconds: 0.25 });
    expect(toElapsedSeconds(86400, 1, 86400)).toEqual({ kind: 'within-horizon', seconds: 86400 });
    expect(toElapsedSeconds('86400.00001', 1, 86400)).toEqual({ kind: 'beyond-horizon' });
    expect(toElapsedSeconds('1e1000', '1e-1000', 86400)).toEqual({ kind: 'beyond-horizon' });
    expect(toElapsedSeconds('1e-1000', '1e1000', 86400)).toEqual({ kind: 'below-resolution' });
    expect(toElapsedSeconds(0, 1, 0)).toEqual({ kind: 'within-horizon', seconds: 0 });
    expect(toElapsedSeconds(1, 1, 0)).toEqual({ kind: 'beyond-horizon' });
    expect(toElapsedSeconds(Number.MIN_VALUE, 1, 1)).toEqual({ kind: 'within-horizon', seconds: Number.MIN_VALUE });
    expect(toElapsedSeconds(Number.MAX_VALUE, 1, Number.MAX_VALUE)).toEqual({ kind: 'beyond-horizon' });
  });

  it('rejects invalid amounts/rates/horizons instead of manufacturing time', () => {
    for (const invalid of [-1, NaN, Infinity]) {
      expect(() => toElapsedSeconds(invalid, 1, 86400)).toThrow();
      expect(() => toElapsedSeconds(1, invalid, 86400)).toThrow();
      expect(() => toElapsedSeconds(1, 1, invalid)).toThrow();
    }
    expect(() => toElapsedSeconds(1, 0, 86400)).toThrow(RangeError);
    expect(() => toElapsedSeconds(0, 0, 86400)).toThrow(RangeError);
  });
});
