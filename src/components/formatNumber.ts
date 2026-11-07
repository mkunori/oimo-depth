const standard = new Intl.NumberFormat('ja-JP', {
  maximumFractionDigits: 1,
  roundingMode: 'trunc',
});

const scientific = new Intl.NumberFormat('ja-JP', {
  notation: 'scientific',
  maximumFractionDigits: 2,
  roundingMode: 'trunc',
});

/** 表示だけを整える。切り捨てにより、未到達の残高や SCORE を繰り上げない。 */
export function formatNumber(value: number | GameNumber): string {
  if (value instanceof GameNumber) {
    if (value.abs().gte(0.1) && value.abs().lt(1e9) || value.isZero()) return standard.format(value.toFiniteNumber());
    return value.format();
  }
  return (value >= 1e9 ? scientific : standard).format(value);
}

const multiplier = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 5 });
export function formatMultiplier(value: number): string { return multiplier.format(value); }
import { GameNumber } from '../core/numbers';
