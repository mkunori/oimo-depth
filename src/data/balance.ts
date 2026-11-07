import { gn } from '../core/numbers';
/** v0 の検証値。バランス調整はこのテーブルに集約する。 */
export const INITIAL_BALANCE = Object.freeze({
  scoreCap: gn(1_000_000),
  baseProduction: gn(1),
});
