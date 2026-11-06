import { describe, expect, it } from 'vitest';
import { advanceGame } from '../../core/game';
import { createSave, parseSave, serializeSave } from '../../core/save';
import { createInitialState } from '../../core/state';
import { prestigeGame } from '../../core/prestige';
import { GameSession } from './GameSession';
import { SAVE_STORAGE_KEY } from './SaveRepository';
import type { SaveStorage } from './SaveRepository';

const START = 1_700_000_000_000;

class MemoryStorage implements SaveStorage {
  value: string | null = null;
  writes = 0;
  failReads = false;
  failWrites = false;
  getItem() {
    if (this.failReads) throw new Error('denied');
    return this.value;
  }
  setItem(key: string, value: string) {
    expect(key).toBe(SAVE_STORAGE_KEY);
    if (this.failWrites) throw new Error('quota');
    this.writes += 1;
    this.value = value;
  }
}

function setup(storage = new MemoryStorage()) {
  let wall = START;
  let mono = 0;
  const session = new GameSession(storage, { wallNow: () => wall, monotonicNow: () => mono });
  return {
    session, storage,
    elapse(seconds: number) { wall += seconds * 1_000; mono += seconds * 1_000; },
    rewindClock(seconds: number) { wall -= seconds * 1_000; },
    nextSession() { return new GameSession(storage, { wallNow: () => wall, monotonicNow: () => mono }); },
  };
}

describe('prestige persistence and migration', () => {
  it('retains actual v2 progress and raw text if a v3 migration write fails', () => {
    const game = setup();
    const legacyState = { ...createInitialState(), imo: 90, runEarnedScore: 100,
      equipmentCounts: { worker: 10, cart: 0, harvester: 0 } };
    const text = JSON.stringify({ saveVersion: 2, savedAt: START, gameState: legacyState });
    game.storage.value = text;
    game.storage.failWrites = true;
    game.session.start();
    expect(game.storage.value).toBe(text);
    expect(game.session.getSnapshot().status).toBe('unavailable');
    expect(game.session.getSnapshot().gameState.equipmentCounts.worker).toBe(10);
    expect(game.session.getSnapshot().gameState.equipmentCounts.deepDrill).toBe(0);
    expect(parseSave(game.session.exportText()).gameState.equipmentCounts.worker).toBe(10);
  });

  it('migrates v1 after offline settlement and commits v3 without losing equipment', () => {
    const game = setup();
    game.storage.value = JSON.stringify({ saveVersion: 1, savedAt: START - 1_000, gameState: { imo: 90, runEarnedScore: 100, equipmentCounts: { worker: 1, cart: 0, harvester: 0 } } });
    game.session.start();
    expect(JSON.parse(game.storage.value!).saveVersion).toBe(3);
    expect(game.session.getSnapshot().gameState.imo).toBe(92);
    expect(game.session.getSnapshot().gameState.runEarnedScore).toBe(102);
    expect(game.session.getSnapshot().gameState.equipmentCounts.worker).toBe(1);
    expect(game.session.getSnapshot().gameState.permanent).toEqual(createInitialState().permanent);
  });

  it('preserves original legacy text if the migration cannot be saved', () => {
    const game = setup();
    const legacy = JSON.stringify({ saveVersion: 1, savedAt: START, gameState: { imo: 90, runEarnedScore: 100, equipmentCounts: { worker: 1, cart: 0, harvester: 0 } } });
    game.storage.value = legacy;
    game.storage.failWrites = true;
    game.session.start();
    expect(game.session.getSnapshot().status).toBe('unavailable');
    expect(game.storage.value).toBe(legacy);
    expect(parseSave(game.session.exportText()).gameState.imo).toBe(90);
  });

  it.each([
    JSON.stringify({ saveVersion: 2, savedAt: START, gameState: { imo: 0, runEarnedScore: 0, equipmentCounts: { worker: 0, cart: 0, harvester: 0 } } }),
    JSON.stringify({ saveVersion: 4, savedAt: START, gameState: createInitialState() }),
  ])('preserves malformed v2 or future text without fallback %#', (text) => {
    const game = setup();
    game.storage.value = text;
    game.session.start();
    expect(game.session.getSnapshot().status).toBe('invalid');
    expect(game.storage.value).toBe(text);
    expect(game.storage.writes).toBe(0);
  });

  it('saves a single reward and each skill, preserving growth through reload and resume', () => {
    const game = setup();
    game.storage.value = serializeSave(createSave(advanceGame(createInitialState(), 1_000_000), START));
    game.session.start();
    expect(game.session.prestige(2)).toBe(true);
    expect(game.session.prestige(2)).toBe(false);
    const second = game.nextSession();
    second.start();
    expect(second.getSnapshot().gameState.permanent.prestigeCount).toBe(1);
    expect(second.getSnapshot().gameState.permanent.unspentPoints).toBe(2);
    expect(second.buySkill('harvest')).toBe(true);
    expect(parseSave(game.storage.value!).gameState.permanent.skillRanks.harvest).toBe(1);
    const reloaded = game.nextSession();
    reloaded.start();
    expect(reloaded.getSnapshot().gameState.permanent.unspentPoints).toBe(1);
    reloaded.hide();
    game.elapse(3_600);
    reloaded.show();
    expect(reloaded.getSnapshot().gameState.runEarnedScore).toBe(5_400);
    expect(reloaded.getSnapshot().gameState.permanent.skillRanks.harvest).toBe(1);
    expect(reloaded.getSnapshot().gameState.permanent.prestigeCount).toBe(1);
  });

  it('requires an updated confirmation at the cap reward boundary', () => {
    const game = setup();
    game.storage.value = serializeSave(createSave(advanceGame(createInitialState(), 999_999), START));
    game.session.start();
    game.elapse(2);
    expect(game.session.prestige(1)).toBe(false);
    expect(game.session.getSnapshot().gameState.permanent.prestigeCount).toBe(0);
    expect(game.session.prestige(2)).toBe(true);
    expect(game.session.getSnapshot().gameState.permanent.unspentPoints).toBe(2);
  });

  it('retains the run and points if the prestige write fails', () => {
    const game = setup();
    game.storage.value = serializeSave(createSave(advanceGame(createInitialState(), 1_000_000), START));
    game.session.start();
    const before = game.session.getSnapshot().gameState;
    const raw = game.storage.value;
    game.storage.failWrites = true;
    expect(game.session.prestige(2)).toBe(false);
    expect(game.session.getSnapshot().gameState).toBe(before);
    expect(game.storage.value).toBe(raw);
    expect(game.session.getSnapshot().status).toBe('unavailable');
  });

  it('does not spend points or grant a skill if its write fails', () => {
    const game = setup();
    game.storage.value = serializeSave(createSave(prestigeGame(advanceGame(createInitialState(), 1_000_000)), START));
    game.session.start();
    const raw = game.storage.value;
    game.storage.failWrites = true;
    expect(game.session.buySkill('harvest')).toBe(false);
    expect(game.session.getSnapshot().gameState.permanent.unspentPoints).toBe(2);
    expect(game.session.getSnapshot().gameState.permanent.skillRanks.harvest).toBe(0);
    expect(game.storage.value).toBe(raw);
  });
});

describe('game save lifecycle', () => {
  it('does not read or write during construction, and starts exactly once', () => {
    const { session, storage } = setup();
    expect(storage.writes).toBe(0);
    session.start();
    const initial = session.getSnapshot();
    session.start();
    expect(session.getSnapshot()).toBe(initial);
    expect(storage.writes).toBe(1);
    expect(initial.status).toBe('ready');
  });

  it('autosaves at ten seconds and immediately saves purchases for reload', () => {
    const setupGame = setup();
    const { session, storage } = setupGame;
    session.start();
    setupGame.elapse(9);
    session.tick();
    expect(storage.writes).toBe(1);
    setupGame.elapse(1);
    session.tick();
    expect(storage.writes).toBe(2);
    session.purchase('worker', 1);
    expect(storage.writes).toBe(3);
    const save = parseSave(storage.value!);
    expect(save.gameState.imo).toBe(0);
    expect(save.gameState.runEarnedScore).toBe(10);
    expect(save.gameState.equipmentCounts.worker).toBe(1);
    const reloaded = setupGame.nextSession();
    reloaded.start();
    expect(reloaded.getSnapshot().gameState).toEqual(save.gameState);
  });

  it('consumes a loaded offline reward once even across repeat starts and reloads', () => {
    const game = setup();
    game.storage.value = serializeSave(createSave(createInitialState(), START - 3_600_000));
    game.session.start();
    game.session.start();
    expect(game.session.getSnapshot().gameState.imo).toBe(3_600);
    const reloaded = game.nextSession();
    reloaded.start();
    expect(reloaded.getSnapshot().gameState.imo).toBe(3_600);
    expect(reloaded.getSnapshot().report?.earnedImo).toBe(0);
  });

  it('saves on hide, ignores hidden ticks, and settles visibility/page events only once', () => {
    const game = setup();
    game.session.start();
    game.elapse(5);
    game.session.hide();
    const writes = game.storage.writes;
    game.session.hide();
    expect(game.storage.writes).toBe(writes);
    game.elapse(48 * 3_600);
    game.session.tick();
    expect(game.session.getSnapshot().gameState.imo).toBe(5);
    game.session.show();
    game.session.show();
    game.session.tick();
    expect(game.session.getSnapshot().gameState.imo).toBe(86_405);
    expect(game.session.getSnapshot().report?.appliedSeconds).toBe(86_400);
    const reloaded = game.nextSession();
    reloaded.start();
    expect(reloaded.getSnapshot().gameState.imo).toBe(86_405);
  });

  it.each(['broken', '', '{"saveVersion":0}'])('preserves corrupt or unsupported raw text %s until explicit replacement', (text) => {
    const game = setup();
    game.storage.value = text;
    game.session.start();
    game.elapse(100);
    game.session.tick();
    game.session.purchase('worker', 1);
    game.session.hide();
    game.session.show();
    expect(game.session.getSnapshot().status).toBe('invalid');
    expect(game.storage.value).toBe(text);
    expect(game.storage.writes).toBe(0);
    expect(game.session.exportText()).toBe(text);
    const incoming = createSave(advanceGame(createInitialState(), 100), START);
    expect(game.session.importSave(incoming)).toBe(true);
    expect(parseSave(game.storage.value!).gameState).toEqual(incoming.gameState);
  });

  it('restores exactly the imported state without adding offline rewards from that text', () => {
    const game = setup();
    game.session.start();
    game.elapse(100);
    game.session.purchase('worker', 1);
    const exported = parseSave(game.session.exportText());
    game.elapse(3_600);
    game.session.tick();
    expect(game.session.importSave(exported)).toBe(true);
    expect(game.session.getSnapshot().gameState).toEqual(exported.gameState);
    expect(parseSave(game.storage.value!).savedAt).toBe(START + 3_700_000);
  });

  it('preserves current state and save on an invalid programmatic import', () => {
    const game = setup();
    game.session.start();
    const snapshot = game.session.getSnapshot();
    const raw = game.storage.value;
    const invalid = { ...createSave(createInitialState(), START), gameState: { ...createInitialState(), imo: -1 } };
    expect(() => game.session.importSave(invalid)).toThrow();
    expect(game.session.getSnapshot()).toBe(snapshot);
    expect(game.storage.value).toBe(raw);
  });

  it('keeps both the stored value and current in-memory game if replacement cannot be written', () => {
    const game = setup();
    game.session.start();
    game.elapse(100);
    game.session.tick();
    const state = game.session.getSnapshot().gameState;
    const raw = game.storage.value;
    game.storage.failWrites = true;
    expect(game.session.reset()).toBe(false);
    expect(game.session.getSnapshot().gameState).toBe(state);
    expect(game.storage.value).toBe(raw);
    expect(game.session.getSnapshot().status).toBe('unavailable');
    expect(parseSave(game.session.exportText()).gameState).toEqual(state);
  });

  it('reports denied storage without overwriting an unread save', () => {
    const game = setup();
    game.storage.value = 'existing';
    game.storage.failReads = true;
    game.session.start();
    expect(game.session.getSnapshot().status).toBe('unavailable');
    expect(game.storage.value).toBe('existing');
    expect(game.storage.writes).toBe(0);
  });

  it('detects another tab before writing and never overwrites its value', () => {
    const game = setup();
    game.session.start();
    game.elapse(100);
    game.session.tick();
    const external = serializeSave(createSave(advanceGame(createInitialState(), 5), START));
    game.storage.value = external;
    game.session.purchase('worker', 1);
    game.session.hide();
    expect(game.session.reset()).toBe(false);
    expect(game.session.getSnapshot().status).toBe('conflict');
    expect(game.storage.value).toBe(external);
    expect(game.session.getSnapshot().gameState.equipmentCounts.worker).toBe(0);
  });

  it('freezes both tabs when divergent storage events are detected', () => {
    const game = setup();
    game.session.start();
    game.session.storageChanged('different save');
    const before = game.session.getSnapshot().gameState;
    game.elapse(100);
    game.session.tick();
    expect(game.session.getSnapshot().status).toBe('conflict');
    expect(game.session.getSnapshot().gameState).toBe(before);
  });

  it('does not mutate input or double count after a backwards wall-clock change', () => {
    const game = setup();
    game.session.start();
    game.session.hide();
    game.rewindClock(3_600);
    game.session.show();
    expect(game.session.getSnapshot().report?.clockReversed).toBe(true);
    expect(game.session.getSnapshot().gameState.imo).toBe(0);
    expect(parseSave(game.storage.value!).savedAt).toBe(START);
  });

  it('reinitializes explicitly and resets the time baseline without adding the old interval', () => {
    const game = setup();
    game.session.start();
    game.elapse(100);
    game.session.tick();
    expect(game.session.reset()).toBe(true);
    expect(game.session.getSnapshot().gameState).toEqual(createInitialState());
    game.elapse(1);
    game.session.tick();
    expect(game.session.getSnapshot().gameState.imo).toBe(1);
    expect(parseSave(game.storage.value!).gameState).toEqual(createInitialState());
  });
});
