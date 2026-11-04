import { describe, expect, it } from 'vitest';
import { advanceGame } from '../../core/game';
import { createSave, parseSave, serializeSave } from '../../core/save';
import { createInitialState } from '../../core/state';
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
