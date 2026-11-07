import Decimal from 'break_eternity.js';

export type GameNumberInput = number | string | GameNumber;
export type NumberOrder = -1 | 0 | 1;
export const MAX_NUMBER_TEXT_LENGTH = 256;
const MAX_LAYER = Number.MAX_SAFE_INTEGER - 1;
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/;
const COMPONENT_TEXT = /^gn1:(-1|0|1):(0|[1-9]\d*):(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?)$/;
const nativeValues = new Map<number, GameNumber>();

function normalize(value: Decimal): Decimal {
  const result = new Decimal(value).normalize();
  return validate(result);
}

function validate(result: Decimal): Decimal {
  if (!result.isFinite() || !Number.isFinite(result.mag)
    || !Number.isSafeInteger(result.layer) || result.layer < 0 || result.layer > MAX_LAYER
    || ![-1, 0, 1].includes(result.sign)) throw new RangeError('GameNumber is outside the finite supported range.');
  return result;
}

/** The library accepts many permissive notations. Only our two explicit grammars cross this boundary. */
function parseText(text: string): Decimal {
  if (text.length === 0 || text.length > MAX_NUMBER_TEXT_LENGTH) throw new RangeError('Invalid GameNumber text length.');
  const components = COMPONENT_TEXT.exec(text);
  if (components) {
    const sign = Number(components[1]);
    const layer = Number(components[2]);
    const mag = Number(components[3]);
    if (!Number.isSafeInteger(layer) || layer > MAX_LAYER || !Number.isFinite(mag)) throw new RangeError('Invalid GameNumber components.');
    const result = normalize(Decimal.fromComponents(sign, layer, mag));
    // Accept only the canonical, already-normalized representation emitted by toString().
    if (`gn1:${result.sign}:${result.layer}:${result.mag}` !== text) throw new RangeError('Non-canonical GameNumber components.');
    return result;
  }
  const decimal = DECIMAL_TEXT.exec(text);
  if (!decimal || decimal[0] !== text || (decimal[1] !== undefined && !Number.isSafeInteger(Number(decimal[1])))) throw new RangeError('Invalid GameNumber decimal text.');
  return normalize(new Decimal(text));
}

/** Immutable opaque value. Decimal instances never leave this module. See docs/numbers.md. */
export class GameNumber {
  readonly #value: Decimal;

  private constructor(value: Decimal) {
    // All constructors and arithmetic methods of Decimal already return normalized values.
    this.#value = validate(new Decimal(value));
    Object.freeze(this.#value);
    Object.freeze(this);
  }

  static from(value: GameNumberInput): GameNumber {
    if (value instanceof GameNumber) {
      // Also rejects objects that merely inherit GameNumber.prototype without its private field.
      value.#value;
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const cached = nativeValues.get(value);
      if (cached) return cached;
      const result = new GameNumber(new Decimal(value));
      if (nativeValues.size < 4_096) nativeValues.set(value, result);
      return result;
    }
    if (typeof value === 'string') return new GameNumber(parseText(value));
    throw new TypeError('Expected a finite number, strict numeric string, or GameNumber.');
  }

  add(other: GameNumberInput): GameNumber { const b = GameNumber.from(other); return b.isZero() ? this : this.isZero() ? b : new GameNumber(this.#value.add(b.#value)); }
  subtract(other: GameNumberInput): GameNumber { const b = GameNumber.from(other); return b.isZero() ? this : this.equals(b) ? GameNumber.from(0) : new GameNumber(this.#value.sub(b.#value)); }
  multiply(other: GameNumberInput): GameNumber { const b = GameNumber.from(other); return b.isZero() || this.isZero() ? GameNumber.from(0) : b.equals(1) ? this : this.equals(1) ? b : new GameNumber(this.#value.mul(b.#value)); }
  divide(other: GameNumberInput): GameNumber {
    const divisor = GameNumber.from(other);
    if (divisor.isZero()) throw new RangeError('Cannot divide by zero.');
    if (divisor.equals(1)) return this;
    if (this.equals(divisor)) return GameNumber.from(1);
    return new GameNumber(this.#value.div(divisor.#value));
  }
  pow(other: GameNumberInput): GameNumber {
    const exponent = GameNumber.from(other);
    if (this.sign < 0) {
      // Parity above the safe integer range cannot be inferred reliably.
      if (exponent.#value.layer !== 0 || exponent.abs().compare(Number.MAX_SAFE_INTEGER) > 0 || !Number.isSafeInteger(exponent.toFiniteNumber())) throw new RangeError('Negative bases require a safe integer exponent.');
    }
    if (this.isZero() && exponent.sign < 0) throw new RangeError('Zero cannot have a negative exponent.');
    // Preserve the existing IEEE-754 price curve while its result is in layer 0.
    if (this.#value.layer === 0 && exponent.#value.layer === 0) {
      const result = (this.#value.sign * this.#value.mag) ** (exponent.#value.sign * exponent.#value.mag);
      if (Number.isFinite(result) && (result === 0 ? this.isZero() : Math.abs(result) >= 1e-15 && Math.abs(result) < 9e15)) return GameNumber.from(result);
    }
    return new GameNumber(this.#value.pow(exponent.#value));
  }
  abs(): GameNumber { return this.sign >= 0 ? this : new GameNumber(this.#value.abs()); }
  negate(): GameNumber { return new GameNumber(this.#value.neg()); }
  ceil(): GameNumber { return new GameNumber(this.#value.ceil()); }
  floor(): GameNumber { return new GameNumber(this.#value.floor()); }
  compare(other: GameNumberInput): NumberOrder { return this.#value.cmp(GameNumber.from(other).#value); }
  equals(other: GameNumberInput): boolean { return this.compare(other) === 0; }
  lt(other: GameNumberInput): boolean { return this.compare(other) < 0; }
  lte(other: GameNumberInput): boolean { return this.compare(other) <= 0; }
  gt(other: GameNumberInput): boolean { return this.compare(other) > 0; }
  gte(other: GameNumberInput): boolean { return this.compare(other) >= 0; }
  log10(): GameNumber { return new GameNumber(this.#value.log10()); }
  min(other: GameNumberInput): GameNumber { const b = GameNumber.from(other); return this.compare(b) <= 0 ? this : b; }
  max(other: GameNumberInput): GameNumber { const b = GameNumber.from(other); return this.compare(b) >= 0 ? this : b; }
  get sign(): NumberOrder { return this.#value.sign as NumberOrder; }
  isZero(): boolean { return this.sign === 0; }

  /** Approximate conversion, never implicit. Rejects overflow and nonzero underflow. */
  toFiniteNumber(): number {
    const result = this.#value.toNumber();
    if (!Number.isFinite(result) || (result === 0 && !this.isZero())) throw new RangeError('GameNumber does not fit a finite nonzero number.');
    return result;
  }

  /** Lossless canonical component text for v7 and reports; display text is separate. */
  toString(): string { return `gn1:${this.#value.sign}:${this.#value.layer}:${this.#value.mag}`; }
  toJSON(): never { throw new TypeError('Use encodeGameNumbers before JSON serialization.'); }
  [Symbol.toPrimitive](hint: string): string {
    if (hint === 'string') return this.toString();
    throw new TypeError('Use GameNumber arithmetic and compare(), not JavaScript numeric operators.');
  }

  /** Display toward zero; the inequality guard makes any unavoidable upward conversion explicit. */
  format(significantDigits = 3): string {
    if (!Number.isInteger(significantDigits) || significantDigits < 1 || significantDigits > 15) throw new RangeError('Use 1 to 15 significant digits.');
    if (this.isZero()) return '0';
    const magnitude = this.abs();
    const prefix = this.sign < 0 ? '-' : '';
    const guard = (text: string, candidate: Decimal): string =>
      `${candidate.cmp(magnitude.#value) > 0 ? this.sign < 0 ? '>' : '<' : ''}${prefix}${text}`;
    if (magnitude.compare(0.001) >= 0 && magnitude.compare(1e9) < 0) {
      const text = new Intl.NumberFormat('ja-JP', { maximumSignificantDigits: significantDigits, roundingMode: 'trunc' }).format(magnitude.toFiniteNumber());
      return guard(text, new Decimal(text.replaceAll(',', '')));
    }
    if (this.#value.layer < 2) {
      const exponent = magnitude.#value.exponent;
      const mantissa = magnitude.#value.mantissa;
      const scale = 10 ** (significantDigits - 1);
      const truncated = Math.floor(mantissa * scale) / scale;
      return guard(`${truncated}E${exponent}`, Decimal.fromMantissaExponent(truncated, exponent));
    }
    const magText = new Intl.NumberFormat('en-US', { useGrouping: false, maximumSignificantDigits: significantDigits, roundingMode: 'floor' }).format(this.#value.mag);
    const layer = this.#value.layer;
    const body = `${layer <= 3 ? 'e'.repeat(layer) : `(e^${layer})`}${magText}`;
    return guard(body, Decimal.fromComponents(1, layer, Number(magText)));
  }
}

export const gn = GameNumber.from;

/** Explicit JSON boundary; GameNumber.toJSON remains disabled to prevent accidental lossy encoding. */
export function encodeGameNumbers(value: unknown): unknown {
  if (value instanceof GameNumber) return value.toString();
  if (Array.isArray(value)) return value.map(encodeGameNumbers);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeGameNumbers(item)]));
  return value;
}

/** Rendering-only bounded conversion; very small nonzero amounts can have a zero gauge ratio. */
export function progressRatio(value: GameNumberInput, cap: GameNumberInput): number {
  const target = nonNegativeGameNumber(cap);
  if (target.isZero()) throw new RangeError('Progress cap must be positive.');
  const ratio = nonNegativeGameNumber(value).divide(target).min(1);
  return ratio.lt(Number.MIN_VALUE) ? 0 : ratio.toFiniteNumber();
}

/** Runtime boundary for UI/save input; object-shaped Decimal/JSON values are intentionally rejected. */
export function readGameNumber(value: unknown): GameNumber {
  if (typeof value !== 'number' && typeof value !== 'string' && !(value instanceof GameNumber)) throw new TypeError('Invalid GameNumber input type.');
  return GameNumber.from(value);
}

export function isValidGameNumberInput(value: unknown): value is GameNumberInput {
  try { readGameNumber(value); return true; } catch { return false; }
}

export function nonNegativeGameNumber(value: GameNumberInput): GameNumber {
  const result = GameNumber.from(value);
  if (result.sign < 0) throw new RangeError('Expected a non-negative amount.');
  return result;
}

/** Compare first. A non-power-of-ten target can share the same truncated label with a smaller SCORE. */
export function formatScoreProgress(score: GameNumberInput, cap: GameNumberInput, significantDigits = 3) {
  const current = nonNegativeGameNumber(score), target = nonNegativeGameNumber(cap);
  if (target.isZero()) throw new RangeError('SCORE cap must be positive.');
  const reached = current.compare(target) >= 0;
  const scoreText = current.format(significantDigits), capText = target.format(significantDigits);
  return { score: !reached && scoreText === capText ? `${scoreText}（未到達）` : scoreText, cap: capText, reached };
}

/** Explicit test/measurement tolerance only. Never used by compare(), ceil(), or price eligibility. */
export function approximatelyEqual(a: GameNumberInput, b: GameNumberInput, absoluteTolerance = 1e-9, relativeTolerance = 1e-12): boolean {
  if (!Number.isFinite(absoluteTolerance) || absoluteTolerance < 0 || !Number.isFinite(relativeTolerance) || relativeTolerance < 0 || relativeTolerance > 1) throw new RangeError('Invalid comparison tolerance.');
  const left = GameNumber.from(a), right = GameNumber.from(b);
  if (left.equals(right)) return true;
  const difference = left.subtract(right).abs();
  if (!difference.isZero() && difference.compare(absoluteTolerance) <= 0) return true;
  if (relativeTolerance === 0 || left.sign * right.sign < 0) return false;
  const largest = left.abs().max(right.abs());
  // Multiplying a layer2+ maximum by a tiny tolerance can round straight back to that maximum.
  // Use the equivalent ratio test so unrelated gigantic values cannot pass as "close".
  const ratio = left.abs().min(right.abs()).divide(largest);
  return ratio.compare(GameNumber.from(1).subtract(relativeTolerance)) >= 0;
}

export type ElapsedSeconds =
  | { readonly kind: 'within-horizon'; readonly seconds: number }
  | { readonly kind: 'beyond-horizon' }
  | { readonly kind: 'below-resolution' };

/** Convert amount/rate only after giant-number comparison to a finite time horizon. No epsilon credit. */
export function toElapsedSeconds(amount: GameNumberInput, rate: GameNumberInput, horizonSeconds: number): ElapsedSeconds {
  if (!Number.isFinite(horizonSeconds) || horizonSeconds < 0) throw new RangeError('Time horizon must be finite and non-negative.');
  const gap = nonNegativeGameNumber(amount), speed = nonNegativeGameNumber(rate);
  if (speed.isZero()) throw new RangeError('Production rate must be positive.');
  if (gap.isZero()) return { kind: 'within-horizon', seconds: 0 };
  const time = gap.divide(speed);
  if (time.compare(horizonSeconds) > 0) return { kind: 'beyond-horizon' };
  if (time.compare(Number.MIN_VALUE) < 0) return { kind: 'below-resolution' };
  let seconds: number;
  try { seconds = time.toFiniteNumber(); }
  catch (error) {
    if (!(error instanceof RangeError)) throw error;
    // At the native extrema normalization itself may cross the last representable bit.
    return { kind: time.compare(1) < 0 ? 'below-resolution' : 'beyond-horizon' };
  }
  return seconds <= horizonSeconds ? { kind: 'within-horizon', seconds } : { kind: 'beyond-horizon' };
}
