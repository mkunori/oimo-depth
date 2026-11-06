/** 将来設計用の感度分析。現行ゲームの状態や上限は変更しない。 */
export function projectFixedProduction(production: number, targetSeconds = 6 * 3_600) {
  if (!Number.isFinite(production) || production <= 0 || !Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    throw new RangeError('Production and target duration must be positive and finite.');
  }
  return [[1e6, 1e9], [1e9, 1e12], [1e12, 1e15]].flatMap(([from, to]) => {
    if (from === undefined || to === undefined) throw new Error('Missing projection bounds.');
    return [1, 10, 100, 1_000].map((multiplier) => {
      const rate = production * multiplier;
      const seconds = (to - from) / rate;
      const requiredProduction = (to - from) / targetSeconds;
      if (![rate, seconds, requiredProduction].every(Number.isFinite)) throw new RangeError('Projection exceeds number range.');
      return { from, to, multiplier, production: rate, seconds, requiredProduction, targetSeconds, requiredMultiplier: requiredProduction / production };
    });
  });
}
