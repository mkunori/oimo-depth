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
export function formatNumber(value: number): string {
  return (value >= 1e9 ? scientific : standard).format(value);
}

const multiplier = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 5 });
export function formatMultiplier(value: number): string { return multiplier.format(value); }
