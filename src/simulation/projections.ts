import { GameNumber, gn } from '../core/numbers';
import { getAmountSeconds } from '../core/game';
/** Fixed-production sensitivity only; this does not change live SCORE caps. */
export function projectFixedProduction(input: GameNumber | number, targetSeconds = 6 * 3_600) {
  if (typeof input === 'number' && !Number.isFinite(input)) throw new RangeError('Production must be finite.');
  const production = gn(input);
  if (production.lte(0) || !Number.isFinite(targetSeconds) || targetSeconds <= 0) throw new RangeError('Production and target duration must be positive.');
  return [[1e6, 1e9], [1e9, 1e12], [1e12, 1e15]].flatMap(([fromValue, toValue]) => {
    const from = gn(fromValue!), to = gn(toValue!), difference = to.subtract(from);
    return [1, 10, 100, 1_000].map((multiplier) => {
      const rate = production.multiply(multiplier);
      const seconds = getAmountSeconds(difference, rate);
      if (seconds === null) throw new RangeError('Projection duration exceeds native time range.');
      const requiredProduction = difference.divide(targetSeconds);
      return { from, to, multiplier, production: rate, seconds, requiredProduction, targetSeconds, requiredMultiplier: requiredProduction.divide(production) };
    });
  });
}
