import { testAmount as gn, stringifyTestSave } from '../../test/amounts';

import { describe, expect, it } from 'vitest';
import { advanceGame } from '../../core/game';
import { createSave, parseSave, serializeSave, SAVE_VERSION } from '../../core/save';
import { createInitialState } from '../../core/state';
import { prestigeGame } from '../../core/prestige';
import { GameSession } from './GameSession';
import { SAVE_STORAGE_KEY } from './SaveRepository';
import type { SaveStorage } from './SaveRepository';
import { createAutomationReadyState, createBreakthroughReadyState, createResearchReadyState } from '../../test/progress';
import { performDeepResearch, purchaseResearch } from '../../core/research';

describe('research session transactions', () => {
  it('persists breakthrough/upgrades/refund and restores through export/import without an extra purchase', () => {
    const game = setup();
    game.storage.value = serializeSave(createSave(createResearchReadyState(), START)); game.session.start();
    const before = game.session.getSnapshot().gameState;
    expect(game.session.deepResearch()).toBe(true);
    expect(game.session.deepResearch()).toBe(false);
    expect(game.session.getSnapshot().gameState.permanent.deepResearchCount).toBe(1);
    expect(game.session.getSnapshot().gameState.permanent.skillRanks.harvest).toBe(0);
    expect(game.session.getSnapshot().gameState.permanent.unspentPoints).toBe(7);
    expect(game.session.getSnapshot().gameState.imo).toBeAmount(before.imo);
    expect(game.session.buyResearch('geology')).toBe(true);
    expect(parseSave(game.storage.value!).gameState.researchRanks.geology).toBe(1);
    const exported = parseSave(game.session.exportText());
    const next = game.nextSession(); next.start();
    expect(next.getSnapshot().gameState).toEqual(exported.gameState);
    expect(next.importSave(exported)).toBe(true);
    expect(next.resetResearch()).toBe(true);
    expect(next.getSnapshot().gameState.imo).toBeAmount(before.imo);
    expect(next.getSnapshot().gameState.runEarnedScore).toBeAmount(before.runEarnedScore);
    expect(next.resetResearch()).toBe(false);
  });

  it.each(['breakthrough', 'upgrade', 'refund'] as const)('retains the prior state/raw save when %s cannot be written', (action) => {
    const game = setup();
    const ready = createResearchReadyState();
    const initial = action === 'breakthrough' ? ready : action === 'upgrade' ? performDeepResearch(ready) : purchaseResearch(performDeepResearch(ready), 'geology');
    game.storage.value = serializeSave(createSave(initial, START)); game.session.start();
    const state = game.session.getSnapshot().gameState; const raw = game.storage.value;
    game.storage.failWrites = true;
    const succeeded = action === 'breakthrough' ? game.session.deepResearch() : action === 'upgrade' ? game.session.buyResearch('geology') : game.session.resetResearch();
    expect(succeeded).toBe(false);
    expect(game.session.getSnapshot().gameState).toBe(state);
    expect(game.storage.value).toBe(raw);
    expect(game.session.getSnapshot().status).toBe('unavailable');
  });

  it('settles old production before research, rejects hidden actions, and blocks stale-tab purchases', () => {
    const game = setup(); const ready = performDeepResearch(createResearchReadyState());
    game.storage.value = serializeSave(createSave(ready, START)); game.session.start();
    game.elapse(60);
    expect(game.session.buyResearch('geology')).toBe(true);
    expect(game.session.getSnapshot().gameState.runEarnedScore).toBeAmount(1e9 + 60);
    game.session.hide();
    expect(game.session.buyResearch('geology')).toBe(false);
    expect(game.session.resetResearch()).toBe(false);
    game.session.show();
    const external = serializeSave(createSave(ready, START + 60_000)); game.storage.value = external;
    expect(game.session.buyResearch('geology')).toBe(false);
    expect(game.session.getSnapshot().status).toBe('conflict');
    expect(game.storage.value).toBe(external);
    const readyGame = setup();
    readyGame.storage.value = serializeSave(createSave(createResearchReadyState(), START)); readyGame.session.start();
    const original = readyGame.session.getSnapshot().gameState;
    const conflicting = serializeSave(createSave(original, START + 1)); readyGame.storage.value = conflicting;
    expect(readyGame.session.deepResearch()).toBe(false);
    expect(readyGame.session.getSnapshot().gameState).toBe(original);
    expect(readyGame.storage.value).toBe(conflicting);
  });
});

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

describe('automation session transactions', () => {
  it('settles the old interval before toggling and avoids duplicate manual purchases', () => {
    const game = setup();
    const initial = createAutomationReadyState();
    game.storage.value = serializeSave(createSave(initial, START)); game.session.start();
    game.elapse(10);
    expect(game.session.setAutomation({ ...initial.automation, enabled: true })).toBe(true);
    let state = game.session.getSnapshot().gameState;
    expect(state.runEarnedScore).toBeAmount(15);
    expect(state.equipmentCounts.worker).toBe(1);
    expect(state.imo).toBeAmount(5);
    expect(game.session.getSnapshot().automaticPurchases).toBe(1);
    game.session.purchase('worker', 1);
    expect(game.session.getSnapshot().gameState.equipmentCounts.worker).toBe(1);
    expect(game.session.setAutomation({ ...state.automation, enabled: false })).toBe(true);
    game.elapse(60); game.session.tick();
    state = game.session.getSnapshot().gameState;
    expect(state.equipmentCounts.worker).toBe(1);
    expect(state.automation.enabled).toBe(false);
    expect(state.imo).toBeAmount(185);
  });

  it('preserves OFF settings and funds if enabling cannot be written', () => {
    const game = setup();
    const initial = { ...createAutomationReadyState(), imo: gn(100), runEarnedScore: gn(100) };
    game.storage.value = serializeSave(createSave(initial, START)); game.session.start();
    const state = game.session.getSnapshot().gameState; const raw = game.storage.value;
    game.storage.failWrites = true;
    expect(game.session.setAutomation({ ...state.automation, enabled: true })).toBe(false);
    expect(game.session.getSnapshot().gameState).toBe(state);
    expect(game.storage.value).toBe(raw);
    expect(game.session.getSnapshot().status).toBe('unavailable');
  });

  it('handles offline purchases once, keeps configuration through reload/import, and stops stale-tab edits', () => {
    const game = setup(); const initial = createAutomationReadyState();
    game.storage.value = serializeSave(createSave(initial, START)); game.session.start();
    expect(game.session.setAutomation({ ...initial.automation, enabled: true, policy: 'priority' })).toBe(true);
    game.session.hide(); game.elapse(21_600); game.session.show();
    const state = game.session.getSnapshot().gameState;
    expect(state.runEarnedScore).toBeAmount(1e6);
    expect(game.session.getSnapshot().report?.automaticPurchases).toBeGreaterThan(0);
    game.session.show(); expect(game.session.getSnapshot().gameState).toBe(state);
    const reloaded = game.nextSession(); reloaded.start();
    expect(reloaded.getSnapshot().gameState.automation).toEqual(state.automation);
    expect(reloaded.importSave(parseSave(reloaded.exportText()))).toBe(true);
    expect(reloaded.getSnapshot().gameState.equipmentCounts).toEqual(state.equipmentCounts);
    const external = serializeSave(createSave(createInitialState(), START)); game.storage.value = external;
    expect(reloaded.setAutomation({ ...state.automation, enabled: false })).toBe(false);
    expect(reloaded.getSnapshot().status).toBe('conflict'); expect(game.storage.value).toBe(external);
  });

  it('retains real v4 progress and raw text when v5 migration cannot be written', () => {
    const game = setup(); const { automation: _settings, ...legacy } = createBreakthroughReadyState();
    const { automation: _rank, ...skillRanks } = legacy.permanent.skillRanks;
    const text = stringifyTestSave({ saveVersion: 4, savedAt: START, gameState: { ...legacy, permanent: { ...legacy.permanent, skillRanks } } });
    game.storage.value = text; game.storage.failWrites = true; game.session.start();
    expect(game.session.getSnapshot().status).toBe('unavailable'); expect(game.storage.value).toBe(text);
    expect(game.session.getSnapshot().gameState.runEarnedScore).toBeAmount(1e6);
    expect(game.session.getSnapshot().gameState.automation.enabled).toBe(false);
  });
});

describe('breakthrough session transactions', () => {
  it('commits before publishing the cap change, persists it, and rejects a second execution', () => {
    const game = setup();
    game.storage.value = serializeSave(createSave(createBreakthroughReadyState(), START));
    game.session.start();
    const before = game.session.getSnapshot().gameState;
    expect(game.session.breakthrough()).toBe(true);
    expect(game.session.getSnapshot().gameState).toEqual({ ...before, scoreCapStage: 1 });
    expect(parseSave(game.storage.value!).gameState.scoreCapStage).toBe(1);
    expect(game.session.breakthrough()).toBe(false);
    const restored = game.nextSession(); restored.start();
    expect(restored.getSnapshot().gameState.scoreCapStage).toBe(1);
    game.elapse(60); restored.tick();
    expect(restored.getSnapshot().gameState.runEarnedScore).toBeGreaterThanAmount(1e6);
    const exported = parseSave(restored.exportText());
    expect(restored.importSave(exported)).toBe(true);
    expect(restored.getSnapshot().gameState).toEqual(exported.gameState);
  });

  it('keeps the capped state and raw save when a breakthrough write fails', () => {
    const game = setup();
    game.storage.value = serializeSave(createSave(createBreakthroughReadyState(), START));
    game.session.start();
    const state = game.session.getSnapshot().gameState;
    const raw = game.storage.value;
    game.storage.failWrites = true;
    expect(game.session.breakthrough()).toBe(false);
    expect(game.session.getSnapshot().gameState).toBe(state);
    expect(game.storage.value).toBe(raw);
    expect(game.session.getSnapshot().status).toBe('unavailable');
    expect(parseSave(game.session.exportText()).gameState.scoreCapStage).toBe(0);
  });

  it('blocks stale-tab, hidden and unqualified breakthrough attempts', () => {
    const initial = setup(); initial.session.start();
    expect(initial.session.breakthrough()).toBe(false);
    const game = setup(); game.storage.value = serializeSave(createSave(createBreakthroughReadyState(), START));
    game.session.start(); game.session.hide();
    expect(game.session.breakthrough()).toBe(false);
    game.session.show();
    const external = serializeSave(createSave(advanceGame(createInitialState(), 5), START));
    game.storage.value = external;
    expect(game.session.breakthrough()).toBe(false);
    expect(game.session.getSnapshot().status).toBe('conflict');
    expect(game.session.getSnapshot().gameState.scoreCapStage).toBe(0);
    expect(game.storage.value).toBe(external);
  });
});

describe('prestige persistence and migration', () => {
  it('retains actual v2 progress and raw text if a v3 migration write fails', () => {
    const game = setup();
    const legacyState = { ...createInitialState(), imo: gn(90), runEarnedScore: gn(100),
      equipmentCounts: { worker: 10, cart: 0, harvester: 0 } };
    const text = stringifyTestSave({ saveVersion: 2, savedAt: START, gameState: legacyState });
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
    game.storage.value = stringifyTestSave({ saveVersion: 1, savedAt: START - 1_000, gameState: { imo: gn(90), runEarnedScore: gn(100), equipmentCounts: { worker: 1, cart: 0, harvester: 0 } } });
    game.session.start();
    expect(JSON.parse(game.storage.value!).saveVersion).toBe(SAVE_VERSION);
    expect(game.session.getSnapshot().gameState.imo).toBeAmount(92);
    expect(game.session.getSnapshot().gameState.runEarnedScore).toBeAmount(102);
    expect(game.session.getSnapshot().gameState.equipmentCounts.worker).toBe(1);
    expect(game.session.getSnapshot().gameState.permanent).toEqual(createInitialState().permanent);
  });

  it('preserves original legacy text if the migration cannot be saved', () => {
    const game = setup();
    const legacy = stringifyTestSave({ saveVersion: 1, savedAt: START, gameState: { imo: gn(90), runEarnedScore: gn(100), equipmentCounts: { worker: 1, cart: 0, harvester: 0 } } });
    game.storage.value = legacy;
    game.storage.failWrites = true;
    game.session.start();
    expect(game.session.getSnapshot().status).toBe('unavailable');
    expect(game.storage.value).toBe(legacy);
    expect(parseSave(game.session.exportText()).gameState.imo).toBeAmount(90);
  });

  it.each([
    stringifyTestSave({ saveVersion: 2, savedAt: START, gameState: { imo: gn(0), runEarnedScore: gn(0), equipmentCounts: { worker: 0, cart: 0, harvester: 0 } } }),
    stringifyTestSave({ saveVersion: SAVE_VERSION + 1, savedAt: START, gameState: createInitialState() }),
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
    expect(reloaded.getSnapshot().gameState.runEarnedScore).toBeAmount(5_400);
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
    expect(save.gameState.imo).toBeAmount(0);
    expect(save.gameState.runEarnedScore).toBeAmount(10);
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
    expect(game.session.getSnapshot().gameState.imo).toBeAmount(3_600);
    const reloaded = game.nextSession();
    reloaded.start();
    expect(reloaded.getSnapshot().gameState.imo).toBeAmount(3_600);
    expect(reloaded.getSnapshot().report?.earnedImo).toBeAmount(0);
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
    expect(game.session.getSnapshot().gameState.imo).toBeAmount(5);
    game.session.show();
    game.session.show();
    game.session.tick();
    expect(game.session.getSnapshot().gameState.imo).toBeAmount(86_405);
    expect(game.session.getSnapshot().report?.appliedSeconds).toBe(86_400);
    const reloaded = game.nextSession();
    reloaded.start();
    expect(reloaded.getSnapshot().gameState.imo).toBeAmount(86_405);
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
    const invalid = { ...createSave(createInitialState(), START), gameState: { ...createInitialState(), imo: gn(-1) } };
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
    expect(game.session.getSnapshot().gameState.imo).toBeAmount(0);
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
    expect(game.session.getSnapshot().gameState.imo).toBeAmount(1);
    expect(parseSave(game.storage.value!).gameState).toEqual(createInitialState());
  });
});
