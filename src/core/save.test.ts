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
    { imo: '1', runEarnedScore: 1, equipmentCounts: { worker: 0, cart: 0, harvester: 0 } },
    { ...owned, imo: -1 },
    { ...owned, imo: NaN },
    { ...owned, imo: Infinity },
    { ...owned, imo: 101 },
    { ...owned, runEarnedScore: 1_000_001 },
    { ...owned, runEarnedScore: -1 },
    { ...owned, equipmentCounts: null },
    { ...owned, equipmentCounts: {} },
    { ...owned, equipmentCounts: { worker: -1, cart: 0, harvester: 0 } },
    { ...owned, equipmentCounts: { worker: 0.5, cart: 0, harvester: 0 } },
    { ...owned, equipmentCounts: { worker: 1_000, cart: 0, harvester: 0 } },
    { ...owned, equipmentCounts: { worker: Number.MAX_SAFE_INTEGER, cart: 0, harvester: 0 } },
  ])('rejects malformed game state %#', (gameState) => {
    expect(() => parseSave(JSON.stringify({ saveVersion: SAVE_VERSION, savedAt: SAVED_AT, gameState }))).toThrow();
  });

  it('copies only known properties rather than adopting arbitrary imported fields', () => {
    const restored = parseSave(JSON.stringify({
      saveVersion: SAVE_VERSION, savedAt: SAVED_AT,
      gameState: { ...owned, extra: 'ignored', equipmentCounts: { ...owned.equipmentCounts, other: 9 } },
    }));
    expect(restored.gameState).toEqual(owned);
  });
});

describe('offline settlement', () => {
  it('adds an hour at the saved production rate without buying equipment', () => {
    const result = settleOffline(createSave(owned, SAVED_AT), SAVED_AT + 3_600_000);

    expect(result.save.gameState).toEqual({ ...owned, imo: 7_290, runEarnedScore: 7_300 });
    expect(result.report).toEqual({ elapsedSeconds: 3_600, appliedSeconds: 3_600, earnedImo: 7_200, reachedScore: 7_300, clockReversed: false });
  });

  it('limits a 48 hour absence to 24 hours', () => {
    const result = settleOffline(createSave(createInitialState(), SAVED_AT), SAVED_AT + 48 * 3_600_000);

    expect(result.save.gameState.imo).toBe(86_400);
    expect(result.report.elapsedSeconds).toBe(172_800);
    expect(result.report.appliedSeconds).toBe(OFFLINE_LIMIT_SECONDS);
    expect(result.report.earnedImo).toBe(86_400);
  });

  it('clips to SCORE cap and preserves the amount previously spent', () => {
    const state = { ...owned, imo: 5, runEarnedScore: 999_999 };
    const result = settleOffline(createSave(state, SAVED_AT), SAVED_AT + 48 * 3_600_000);

    expect(result.save.gameState.imo).toBe(6);
    expect(result.save.gameState.runEarnedScore).toBe(1_000_000);
    expect(result.report.earnedImo).toBe(1);
  });

  it('is deterministic and consumes elapsed time in the returned save', () => {
    const save = createSave(owned, SAVED_AT);
    const now = SAVED_AT + 3_600_000;
    const first = settleOffline(save, now);

    expect(settleOffline(save, now)).toEqual(first);
    expect(settleOffline(first.save, now).report.earnedImo).toBe(0);
    expect(save.gameState).toEqual(owned);
    expect(save.savedAt).toBe(SAVED_AT);
  });

  it('does not credit negative elapsed time or move the save timestamp backward', () => {
    const result = settleOffline(createSave(owned, SAVED_AT), SAVED_AT - 60_000);
    expect(result.report.earnedImo).toBe(0);
    expect(result.report.clockReversed).toBe(true);
    expect(result.save.savedAt).toBe(SAVED_AT);
    expect(settleOffline(result.save, SAVED_AT).report.earnedImo).toBe(0);
  });
});

describe('permanent growth saves and migration', () => {
  it('migrates an actual v1 save while preserving all run values and its timestamp', () => {
    const legacy = { saveVersion: 1, savedAt: SAVED_AT, gameState: { imo: 90.5, runEarnedScore: 100.5, equipmentCounts: { worker: 1, cart: 0, harvester: 0 } } };
    const migrated = parseSave(JSON.stringify(legacy));
    expect(migrated.saveVersion).toBe(2);
    expect(migrated.savedAt).toBe(SAVED_AT);
    expect(migrated.gameState).toEqual({ ...createInitialState(), ...legacy.gameState });
    expect(parseSave(serializeSave(migrated))).toEqual(migrated);
    expect(settleOffline(migrated, SAVED_AT + 1_000).save.gameState.imo).toBe(92.5);
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
    expect(offline.save.gameState.imo).toBe(5_450);
    expect(offline.save.gameState.runEarnedScore).toBe(5_400);
    expect(offline.save.gameState.permanent).toEqual(game.permanent);
    expect(offline.report.earnedImo).toBe(5_400);
  });

  it.each([
    { permanent: null },
    { permanent: {} },
    { permanent: { ...createInitialState().permanent, unspentPoints: 1 } },
    { permanent: { ...createInitialState().permanent, skillRanks: {} } },
    { runStartingImo: -1 },
    { runStartingImo: 50 },
    { runStartingImo: Infinity },
  ])('rejects incomplete or impossible v2 growth state %#', (patch) => {
    expect(() => parseSave(JSON.stringify({ saveVersion: 2, savedAt: SAVED_AT, gameState: { ...createInitialState(), ...patch } }))).toThrow();
  });

  it('does not reinterpret a malformed v2 save as a legacy save', () => {
    expect(() => parseSave(JSON.stringify({ saveVersion: 2, savedAt: SAVED_AT, gameState: { imo: 0, runEarnedScore: 0, equipmentCounts: { worker: 0, cart: 0, harvester: 0 } } }))).toThrow();
  });
});
