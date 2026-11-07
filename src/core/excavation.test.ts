import { describe, expect, it } from 'vitest';
import { advanceGame, advanceWithAutomation, configureAutomation, getProductionPerSecond } from './game';
import { getDigSpeed, getStratum } from './excavation';
import { createInitialState } from './state';
import { prestigeGame } from './prestige';
import { purchaseDigResearch } from './digResearch';
import { createSave, parseSave, serializeSave, settleOffline, SAVE_VERSION } from './save';
import { gn } from './numbers';
import { createAutomationReadyState } from '../test/progress';
import type { GameState } from './state';
import { STRATA } from '../data/depth';
import { createRootConnectionReadyState } from '../test/progress';
import { performRootConnection } from './rootConnection';

describe('permanent excavation', () => {
  it('integrates exact boundaries and multiple strata, keeps positive speed, and stops at the actual SCORE cap time', () => {
    const initial = createInitialState();
    const at10 = advanceGame(initial, 400);
    expect(at10.permanent.depthMeters).toBe(10); expect(getStratum(at10.permanent.depthMeters)).toBe(1);
    const at100 = advanceGame(at10, 10800);
    expect(at100.permanent.depthMeters).toBe(100);
    const whole = advanceGame(initial, 86400);
    expect(whole.permanent.depthMeters).toBeCloseTo(100 + (2160 - 280) / 12, 9);
    let split = initial;
    for (const seconds of [400, 10800, 30000, 45200]) split = advanceGame(split, seconds);
    expect(split.permanent.depthMeters).toBeCloseTo(whole.permanent.depthMeters, 9);
    for (const layer of STRATA) expect(getDigSpeed({ ...initial, permanent: { ...initial.permanent, depthMeters: layer.start } })).toBeGreaterThan(0);
    const almost = { ...initial, runEarnedScore: gn(1e6 - 100) };
    const capped = advanceGame(almost, 86400);
    expect(capped.permanent.depthMeters).toBe(2.5);
    expect(advanceGame(capped, 86400)).toBe(capped);
    const equipped = advanceGame({ ...almost, equipmentCounts: { ...almost.equipmentCounts, worker: 10 } }, 86400);
    expect(equipped.runEarnedScore).toBeAmount(capped.runEarnedScore);
    expect(equipped.permanent.depthMeters).not.toBe(capped.permanent.depthMeters);
    const root = performRootConnection(createRootConnectionReadyState());
    const linked = { ...root, runEarnedScore: gn(9e14), imo: gn(5e14),
      permanent: { ...root.permanent, depthMeters: 9999.99, depthRemainder: 0 },
      equipmentCounts: { ...root.equipmentCounts, rootRelay: 2, coreChamber: 1 } };
    const secondsToLayer = .01 * 60 / 5.05;
    expect(advanceGame(linked, 1).permanent.depthMeters).toBeCloseTo(10000 + (1 - secondsToLayer) * (5.05 * 1.1 / 500), 8);
  });

  it('orders a simultaneous stratum/purchase and SCORE stop correctly, and matches split/24h offline automation', () => {
    const base = createAutomationReadyState();
    const initial = configureAutomation({ ...base, runEarnedScore: gn(9.25), imo: gn(9.25),
      permanent: { ...base.permanent, depthMeters: 9.9875, depthRemainder: 0 } }, { ...base.automation, enabled: true });
    const event = advanceWithAutomation(initial, 0.5, true);
    expect(event.events[0]?.id).toBe('worker');
    expect(event.state.permanent.depthMeters).toBeCloseTo(10, 10);
    const near = { ...initial, runEarnedScore: gn(1e6 - 0.75) };
    const stopped = advanceWithAutomation(near, 86400);
    expect(stopped.purchaseCount).toBe(0); expect(stopped.state.permanent.depthMeters).toBeCloseTo(10, 10);
    const whole = advanceGame(initial, 86400);
    const split = advanceGame(parseSave(serializeSave(createSave(advanceGame(initial, .5), 0))).gameState, 86400 - .5);
    expect(split.equipmentCounts).toEqual(whole.equipmentCounts);
    expect(Math.abs(split.permanent.depthMeters - whole.permanent.depthMeters)).toBeLessThan(1e-6);
    expect(settleOffline(createSave(initial, 0), 48 * 3600_000).save.gameState).toEqual(whole);
  });

  it('buys optional permanent research without changing production/SCORE, preserves it on prestige and derives rewards once', () => {
    const initial = createInitialState();
    expect(purchaseDigResearch(initial, 'basic')).toBe(initial);
    const state = { ...initial, imo: gn(1e5), runEarnedScore: gn(1e5), permanent: { ...initial.permanent, depthMeters: 100 } };
    const upgraded = purchaseDigResearch(state, 'basic');
    expect(upgraded.imo).toBeAmount(90000); expect(upgraded.runEarnedScore).toBeAmount(1e5);
    expect(getProductionPerSecond(upgraded)).toBeAmount(getProductionPerSecond(state));
    expect(getDigSpeed(upgraded)).toBe(getDigSpeed(state) * 2);
    const next = prestigeGame(upgraded);
    expect(next.permanent.depthMeters).toBe(100); expect(next.permanent.digResearchRanks.basic).toBe(1);
    expect(next.permanent.unspentPoints).toBe(1);
    expect(advanceGame(next, 10).permanent.depthMeters).toBeGreaterThan(100);
    expect(parseSave(serializeSave(createSave(upgraded, 0))).gameState).toEqual(upgraded);
  });

  it('migrates v9 with DEPTH zero, preserves assets and rejects invalid native depth, remainder and hidden research', () => {
    const state = advanceGame(createInitialState(), 100);
    const old = JSON.parse(serializeSave(createSave(state, 1234)));
    old.saveVersion = 9;
    for (const id of ['originMiner', 'imoReactor']) { delete old.gameState.equipmentCounts[id]; delete old.gameState.automation.equipment[id]; }
    old.gameState.automation.priority = old.gameState.automation.priority.filter((id: string) => !['originMiner', 'imoReactor'].includes(id));
    delete old.gameState.permanent.depthMeters; delete old.gameState.permanent.depthRemainder; delete old.gameState.permanent.digResearchRanks;
    const migrated = parseSave(JSON.stringify(old));
    expect(migrated.saveVersion).toBe(SAVE_VERSION); expect(migrated.savedAt).toBe(1234);
    expect(migrated.gameState).toEqual({ ...state, permanent: { ...state.permanent, depthMeters: 0, depthRemainder: 0 } });
    for (const change of [{ depthMeters: -1 }, { depthMeters: Infinity }, { depthMeters: 1e12 + 1 }, { depthMeters: undefined },
      { depthRemainder: 1 }, { digResearchRanks: { basic: 1, vein: 0 } }, { digResearchRanks: { basic: 4, vein: 0 } }]) {
      expect(() => createSave({ ...state, permanent: { ...state.permanent, ...change } } as GameState, 0)).toThrow();
    }
  });
});
