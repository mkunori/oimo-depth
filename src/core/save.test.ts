import { withoutDepth } from '../test/depth';
import { testAmount as gn, stringifyTestSave } from '../test/amounts';

import { describe, expect, it } from 'vitest';
import { createInitialState } from './state';
import { advanceGame, purchaseEquipment } from './game';
import { createSave, OFFLINE_LIMIT_SECONDS, parseSave, SAVE_VERSION, serializeSave, settleOffline } from './save';
import { prestigeGame, purchaseSkill } from './prestige';

const SAVED_AT = 1_700_000_000_000;
const owned = purchaseEquipment(advanceGame(createInitialState(), 100), 'worker', 1);

describe('save format', () => {
  it('round trips all game state values without sharing mutable objects', () => {
    const original = createSave(owned, SAVED_AT);
    const restored = parseSave(serializeSave(original));

    expect(restored).toEqual(original);
    expect(restored.gameState).not.toBe(original.gameState);
    expect(restored.gameState.equipmentCounts).not.toBe(original.gameState.equipmentCounts);
  });

  it.each(['', 'broken', 'null', '[]', '{}', '{"saveVersion":0}', '{"saveVersion":3}'])('rejects invalid or unsupported text %s', (text) => {
    expect(() => parseSave(text)).toThrow();
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid timestamp %s', (time) => {
    expect(() => createSave(owned, time)).toThrow();
    expect(() => settleOffline(createSave(owned, SAVED_AT), time)).toThrow();
  });

  it.each([
    null,
    { imo: '1', runEarnedScore: gn(1), equipmentCounts: { worker: 0, cart: 0, harvester: 0 } },
    { ...owned, imo: gn(-1) },
    { ...owned, imo: gn(NaN) },
    { ...owned, imo: gn(Infinity) },
    { ...owned, imo: gn(101) },
    { ...owned, runEarnedScore: gn(1_000_001) },
    { ...owned, runEarnedScore: gn(-1) },
    { ...owned, equipmentCounts: null },
    { ...owned, equipmentCounts: {} },
    { ...owned, equipmentCounts: { worker: -1, cart: 0, harvester: 0 } },
    { ...owned, equipmentCounts: { worker: 0.5, cart: 0, harvester: 0 } },
    { ...owned, equipmentCounts: { worker: 1_000, cart: 0, harvester: 0 } },
    { ...owned, equipmentCounts: { worker: Number.MAX_SAFE_INTEGER, cart: 0, harvester: 0 } },
  ])('rejects malformed game state %#', (gameState) => {
    expect(() => parseSave(stringifyTestSave({ saveVersion: SAVE_VERSION, savedAt: SAVED_AT, gameState }))).toThrow();
  });

  it('copies only known properties rather than adopting arbitrary imported fields', () => {
    const restored = parseSave(stringifyTestSave({
      saveVersion: SAVE_VERSION, savedAt: SAVED_AT,
      gameState: { ...owned, extra: 'ignored', equipmentCounts: { ...owned.equipmentCounts, other: 9 } },
    }));
    expect(restored.gameState).toEqual(owned);
  });
});

describe('offline settlement', () => {
  it('adds an hour at the saved production rate without buying equipment', () => {
    const result = settleOffline(createSave(owned, SAVED_AT), SAVED_AT + 3_600_000);

    expect(result.save.gameState).toEqual({ ...owned, imo: gn(7_290), runEarnedScore: gn(7_300), permanent: { ...owned.permanent, depthMeters: 43.5 } });
    expect(result.report).toEqual({ elapsedSeconds: 3_600, appliedSeconds: 3_600, earnedImo: gn(7_200), reachedScore: gn(7_300), clockReversed: false, automaticPurchases: 0, earnedDepth: 41 });
  });

  it('limits a 48 hour absence to 24 hours', () => {
    const result = settleOffline(createSave(createInitialState(), SAVED_AT), SAVED_AT + 48 * 3_600_000);

    expect(result.save.gameState.imo).toBeAmount(86_400);
    expect(result.report.elapsedSeconds).toBe(172_800);
    expect(result.report.appliedSeconds).toBe(OFFLINE_LIMIT_SECONDS);
    expect(result.report.earnedImo).toBeAmount(86_400);
  });

  it('clips to SCORE cap and preserves the amount previously spent', () => {
    const state = { ...owned, imo: gn(5), runEarnedScore: gn(999_999) };
    const result = settleOffline(createSave(state, SAVED_AT), SAVED_AT + 48 * 3_600_000);

    expect(result.save.gameState.imo).toBeAmount(6);
    expect(result.save.gameState.runEarnedScore).toBeAmount(1_000_000);
    expect(result.report.earnedImo).toBeAmount(1);
  });

  it('is deterministic and consumes elapsed time in the returned save', () => {
    const save = createSave(owned, SAVED_AT);
    const now = SAVED_AT + 3_600_000;
    const first = settleOffline(save, now);

    expect(settleOffline(save, now)).toEqual(first);
    expect(settleOffline(first.save, now).report.earnedImo).toBeAmount(0);
    expect(save.gameState).toEqual(owned);
    expect(save.savedAt).toBe(SAVED_AT);
  });

  it('does not credit negative elapsed time or move the save timestamp backward', () => {
    const result = settleOffline(createSave(owned, SAVED_AT), SAVED_AT - 60_000);
    expect(result.report.earnedImo).toBeAmount(0);
    expect(result.report.clockReversed).toBe(true);
    expect(result.save.savedAt).toBe(SAVED_AT);
    expect(settleOffline(result.save, SAVED_AT).report.earnedImo).toBeAmount(0);
  });
});

describe('permanent growth saves and migration', () => {
  it('migrates an actual v1 save while preserving all run values and its timestamp', () => {
    const legacy = { saveVersion: 1, savedAt: SAVED_AT, gameState: { imo: gn(90.5), runEarnedScore: gn(100.5), equipmentCounts: { worker: 1, cart: 0, harvester: 0 } } };
    const migrated = parseSave(stringifyTestSave(legacy));
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    expect(migrated.savedAt).toBe(SAVED_AT);
    expect(migrated.gameState).toEqual({ ...createInitialState(), ...legacy.gameState, equipmentCounts: { ...createInitialState().equipmentCounts, ...legacy.gameState.equipmentCounts } });
    expect(parseSave(serializeSave(migrated))).toEqual(migrated);
    expect(settleOffline(migrated, SAVED_AT + 1_000).save.gameState.imo).toBeAmount(92.5);
  });

  it('preserves skill effects, points, count, and starting grant across round trip and offline harvest', () => {
    let game = prestigeGame(advanceGame(createInitialState(), 1_000_000));
    game = purchaseSkill(game, 'harvest');
    game = purchaseSkill(game, 'startingImo');
    game = prestigeGame(advanceGame(game, 1_000_000));
    const restored = parseSave(serializeSave(createSave(game, SAVED_AT)));
    expect(restored.gameState).toEqual(game);
    expect(restored.gameState.permanent.skillRanks).not.toBe(game.permanent.skillRanks);
    const offline = settleOffline(restored, SAVED_AT + 3_600_000);
    expect(offline.save.gameState.imo).toBeAmount(5_450);
    expect(offline.save.gameState.runEarnedScore).toBeAmount(5_400);
    expect(withoutDepth(offline.save.gameState.permanent)).toEqual(withoutDepth(game.permanent));
    expect(offline.report.earnedImo).toBeAmount(5_400);
  });

  it.each([
    { permanent: null },
    { permanent: {} },
    { permanent: { ...createInitialState().permanent, unspentPoints: 1 } },
    { permanent: { ...createInitialState().permanent, skillRanks: {} } },
    { runStartingImo: gn(-1) },
    { runStartingImo: gn(50) },
    { runStartingImo: gn(Infinity) },
  ])('rejects incomplete or impossible v2 growth state %#', (patch) => {
    expect(() => parseSave(stringifyTestSave({ saveVersion: 2, savedAt: SAVED_AT, gameState: { ...createInitialState(), ...patch } }))).toThrow();
  });

  it('does not reinterpret a malformed v2 save as a legacy save', () => {
    expect(() => parseSave(stringifyTestSave({ saveVersion: 2, savedAt: SAVED_AT, gameState: { imo: gn(0), runEarnedScore: gn(0), equipmentCounts: { worker: 0, cart: 0, harvester: 0 } } }))).toThrow();
  });
});
