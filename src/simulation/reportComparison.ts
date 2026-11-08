import { approximatelyEqual, gn } from '../core/numbers';

type Row = Record<string, unknown>;
const ROUNDING_ULPS = 64 * Number.EPSILON;
const timeField = (key: string) => key.endsWith('Seconds') || key.endsWith('_seconds') || key === 'seconds';
const depthField = (key: string) => ['depthMeters', 'depth_meters', 'depthRemainder', 'digSpeed', 'digPower', 'actual_dig_speed'].includes(key) || key.endsWith('_depth_meters');

/** Comparison artifacts may contain platform libm rounding; never use this for
 * core purchases or save validation. Counts, ranks, schema and model hash stay
 * exact. Balance/debt tolerances scale with the accumulated SCORE, not the
 * tiny residual left immediately after paying a large equipment price. */
function sameOrigin(a: unknown, b: unknown, key = '', score = 1, depth = 1, carry = false): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a === 'string' && typeof b === 'string' && a.startsWith('gn1:') && b.startsWith('gn1:')) {
    if (key === 'scoreSpentThisRun' || key === 'spent_score') return false; // canonical receipt total is exact
    const absolute = ['imo', 'spendableScore', 'spendable_score'].includes(key) || carry ? Math.max(1, score * ROUNDING_ULPS) : 1;
    return approximatelyEqual(a, b, absolute, 1e-12);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const absolute = key === 'depthRemainder' ? Math.max(1e-9, depth * ROUNDING_ULPS) : depthField(key) ? 1e-6 : timeField(key) ? 1e-6 : null;
    return absolute !== null && Math.abs(a - b) <= Math.max(absolute, Math.max(Math.abs(a), Math.abs(b)) * 1e-12);
  }
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && a.every((item, index) => sameOrigin(item, b[index], key, score, depth, carry));
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Row, right = b as Row;
  if (Object.keys(left).length !== Object.keys(right).length || Object.keys(left).some((name) => !Object.hasOwn(right, name))) return false;
  const accumulated = left.runEarnedScore ?? left.score;
  const localScore = !carry && typeof accumulated === 'string' && accumulated.startsWith('gn1:') ? gn(accumulated).max(1).toFiniteNumber() : score;
  const localDepth = typeof left.depthMeters === 'number' ? left.depthMeters : depth;
  return Object.entries(left).every(([name, value]) => sameOrigin(value, right[name], name, localScore, localDepth, carry || name === 'productionRemainder'));
}

/** Every earlier family and all non-origin/non-ROOT metadata stay byte exact. */
export function equivalentOriginArtifact(name: string, expected: string, actual: string): boolean {
  try {
    if (name === 'results.json') {
      const { origins: a, rootCycles: rootsA, gear: gearA, gearModes: modesA, deepPrestige: prestigeA, ...left } = JSON.parse(expected) as Row;
      const { origins: b, rootCycles: rootsB, gear: gearB, gearModes: modesB, deepPrestige: prestigeB, ...right } = JSON.parse(actual) as Row;
      return a !== undefined && b !== undefined && JSON.stringify(left) === JSON.stringify(right) && sameOrigin(a, b) && sameOrigin(rootsA, rootsB) && sameOrigin(gearA, gearB) && sameOrigin(modesA, modesB) && sameOrigin(prestigeA, prestigeB);
    }
    if (!['origin.csv', 'origin-timeline.csv', 'root-cycle.csv', 'root-cycle-timeline.csv', 'gear.csv', 'gear-timeline.csv', 'gear-modes.csv', 'gear-modes-timeline.csv', 'deep-prestige.csv'].includes(name)) return false;
    // These generated CSVs quote every cell and contain no embedded line breaks.
    const parse = (text: string) => text.trimEnd().split('\n').map((line) => JSON.parse(`[${line}]`) as string[]);
    const left = parse(expected), right = parse(actual);
    if (left.length !== right.length || JSON.stringify(left[0]) !== JSON.stringify(right[0])) return false;
    const headers = left[0]!;
    const row = (values: string[]) => Object.fromEntries(headers.map((key, index) => {
      const value = values[index];
      return [key, value !== undefined && (timeField(key) || depthField(key)) ? Number(value) : value];
    }));
    return left.slice(1).every((values, index) => values.length === headers.length && right[index + 1]!.length === headers.length && sameOrigin(row(values), row(right[index + 1]!)));
  } catch { return false; }
}
