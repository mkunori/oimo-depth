import type { PermanentProgress } from '../core/state';

/** Existing economic regressions compare economic history; DEPTH now advances
 * during those same intervals and has separate boundary/partition assertions. */
export function withoutDepth(permanent: PermanentProgress) {
  const { depthMeters: _depth, depthRemainder: _carry, ...history } = permanent;
  return history;
}
