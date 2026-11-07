import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gn, encodeGameNumbers, approximatelyEqual, progressRatio } from './numbers';
import { advanceGame, configureAutomation, getEquipmentPrice, getPurchaseQuote, getProductionPerSecond, getNextAutomaticPurchaseSeconds, quoteEquipmentPurchase, NumericProgressError } from './game';
import { createInitialState, createInitialPermanent } from './state';
import { createSave, parseSave, serializeSave, settleOffline, SAVE_VERSION } from './save';
import { createAutomationReadyState, createResearchReadyState } from '../test/progress';
import { performDeepResearch } from './research';
import { performBreakthrough } from './breakthrough';
import { prestigeGame, purchaseSkill } from './prestige';
import { createBreakthroughReadyState } from '../test/progress';
import { GameSession } from '../features/save/GameSession';

const legacyText = readFileSync(new URL('../test/fixtures/save-v6.json', import.meta.url), 'utf8');
const legacy = JSON.parse(legacyText);

describe('v7 amount migration', () => {
  it('preserves a real v6 research save and uses canonical strings only for amounts', () => {
    const migrated = parseSave(legacyText);
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    expect(migrated.savedAt).toBe(legacy.savedAt);
    for (const key of ['imo', 'runEarnedScore', 'runStartingImo'] as const) expect(migrated.gameState[key]).toBeAmount(legacy.gameState[key]);
    expect(migrated.gameState.equipmentCounts).toEqual({ ...legacy.gameState.equipmentCounts, rootRelay: 0, coreChamber: 0 });
    expect(migrated.gameState.permanent).toEqual({ ...legacy.gameState.permanent, deepResearchCount: 1, maxDiscoveredStage: 2, rootConnectionUnlocked: false });
    expect(migrated.gameState.researchRanks).toEqual(legacy.gameState.researchRanks);
    expect(migrated.gameState.automation).toEqual({ ...legacy.gameState.automation, equipment: { ...legacy.gameState.automation.equipment, rootRelay: true, coreChamber: true }, priority: [...legacy.gameState.automation.priority, "rootRelay", "coreChamber"] });
    const raw = JSON.parse(serializeSave(migrated));
    expect(raw.saveVersion).toBe(SAVE_VERSION);
    expect(raw.savedAt).toBeTypeOf('number');
    expect(raw.gameState.imo).toBe(migrated.gameState.imo.toString());
    expect(raw.gameState.equipmentCounts.worker).toBeTypeOf('number');
    expect(raw.gameState.scoreCapStage).toBe(2);
    expect(raw.gameState.permanent.skillRanks.harvest).toBe(3);
    expect(raw.gameState.productionRemainder).toEqual({ score: 'gn1:0:0:0', imo: 'gn1:0:0:0' });
    expect(raw.gameState.automationRemainder).toBeUndefined();
    expect(parseSave(serializeSave(migrated))).toEqual(migrated);
  });

  it.each([1, 2, 3, 4, 5, 6])('preserves v%s numeric amounts and valid legacy progress', (version) => {
    const old = structuredClone(legacy);
    old.saveVersion = version;
    if (version < 6) {
      old.gameState.scoreCapStage = version < 4 ? 0 : 1;
      old.gameState.runEarnedScore = version < 4 ? 1e6 : 1e9;
      old.gameState.imo = 123.5;
      old.gameState.researchRanks = { geology: 0, resonance: 0 };
      old.gameState.permanent.deepResearchUnlocked = false;
      old.gameState.equipmentCounts.deepDrill = 0;
      old.gameState.equipmentCounts.refinery = 0;
    }
    if (version < 5) {
      delete old.gameState.automation;
      old.gameState.permanent.unspentPoints += 1;
      delete old.gameState.permanent.skillRanks.automation;
    } else if (version === 5) {
      delete old.gameState.automation.equipment.veinExtractor;
      delete old.gameState.automation.equipment.concentrator;
      old.gameState.automation.priority = old.gameState.automation.priority.slice(0, 5);
    }
    if (version < 4) {
      old.gameState.permanent.unspentPoints += 3;
      delete old.gameState.permanent.skillRanks.breakthrough;
    }
    const migrated = parseSave(JSON.stringify(old));
    expect(migrated.gameState.imo).toBeAmount(old.gameState.imo);
    expect(migrated.gameState.runEarnedScore).toBeAmount(old.gameState.runEarnedScore);
    expect(migrated.savedAt).toBe(old.savedAt);
    expect(migrated.gameState.equipmentCounts).toEqual({ ...old.gameState.equipmentCounts, rootRelay: 0, coreChamber: 0 });
    expect(parseSave(serializeSave(migrated))).toEqual(migrated);
  });

  it.each([1, null, '', '1', '1e1000', 'Infinity', 'gn1:1:0:NaN', 'gn1:-1:0:1', 'gn1:1:0:01', 'gn1:1:1:1'])('rejects malformed, negative or non-canonical v7 amount %#', (amount) => {
    const raw = JSON.parse(serializeSave(createSave(createInitialState(), 0)));
    raw.gameState.imo = amount;
    expect(() => parseSave(JSON.stringify(raw))).toThrow();
  });

  it('rejects balance/cap overflow and unbounded or missing compensation components', () => {
    const initial = { ...createInitialState(), imo: gn(100), runEarnedScore: gn(100) };
    for (const change of [
      { imo: gn(101) }, { runEarnedScore: gn('1e1000') },
      { productionRemainder: { score: gn(-1), imo: gn(0) } },
      { productionRemainder: { score: gn(0), imo: gn('1e1000') } },
      { productionRemainder: null },
    ]) {
      const raw = { saveVersion: 7, savedAt: 0, gameState: { ...initial, ...change } };
      expect(() => parseSave(JSON.stringify(encodeGameNumbers(raw)))).toThrow();
    }
  });

  it('retains tiny nonzero v7 amounts and permits a rendering-only zero gauge ratio', () => {
    const initial = { ...createInitialState(), imo: gn('1e-1000'), runEarnedScore: gn('1e-1000') };
    const restored = parseSave(serializeSave(createSave(initial, 0)));
    expect(restored.gameState.imo.isZero()).toBe(false);
    expect(restored.gameState.imo.toString()).toBe(initial.imo.toString());
    expect(progressRatio(initial.runEarnedScore, '1e12')).toBe(0);
    expect(advanceGame(restored.gameState, 1).imo.gt(initial.imo)).toBe(true);
  });

  it('keeps original legacy text exportable if migration settlement cannot be written', () => {
    let raw = legacyText;
    const session = new GameSession({ getItem: () => raw, setItem: () => { throw new Error('quota'); } },
      { wallNow: () => legacy.savedAt + 3_600_000, monotonicNow: () => 0 });
    session.start();
    expect(session.getSnapshot().status).toBe('unavailable');
    expect(raw).toBe(legacyText);
    expect(session.exportText()).toBe(legacyText);
    const reloaded = new GameSession({ getItem: () => raw, setItem: (_key, value) => { raw = value; } },
      { wallNow: () => legacy.savedAt + 3_600_000, monotonicNow: () => 0 });
    reloaded.start();
    expect(reloaded.getSnapshot().status).toBe('ready');
    expect(reloaded.getSnapshot().gameState).toEqual(session.getSnapshot().gameState);
    expect(JSON.parse(raw).saveVersion).toBe(SAVE_VERSION);
  });

  it('protects invalid numeric text and does not re-settle the same offline interval', () => {
    const broken = legacyText.replace('"imo": 77522275', '"imo": "NaN"');
    const session = new GameSession({ getItem: () => broken, setItem: () => { throw new Error('must not write'); } },
      { wallNow: () => legacy.savedAt, monotonicNow: () => 0 });
    session.start(); expect(session.getSnapshot().status).toBe('invalid'); expect(session.exportText()).toBe(broken);
    const first = settleOffline(parseSave(legacyText), legacy.savedAt + 48 * 3_600_000);
    expect(first.report.appliedSeconds).toBe(86400);
    const repeated = settleOffline(first.save, first.save.savedAt);
    expect(repeated.save).toEqual(first.save);
    expect(repeated.report.automaticPurchases).toBe(0);
    expect(repeated.report.earnedImo.isZero()).toBe(true);
  });
});

describe('giant prices and bounded progress', () => {
  it('recomputes automatic targets after both cap transitions even when inventory/settings objects are shared', () => {
    const capable = purchaseSkill(prestigeGame(createBreakthroughReadyState()), 'automation');
    let first = { ...capable, imo: gn(500_000), runEarnedScore: gn(999_999),
      equipmentCounts: { ...capable.equipmentCounts, worker: 10, cart: 10, harvester: 10 } };
    first = configureAutomation(first, { ...first.automation, enabled: true, policy: 'balanced' });
    expect(getNextAutomaticPurchaseSeconds(first)).toBe(0);
    const expanded = performBreakthrough({ ...first, runEarnedScore: gn(1e6) });
    expect(advanceGame(expanded, 0).equipmentCounts).toEqual(first.equipmentCounts);
    let second = { ...createResearchReadyState(true), imo: gn(50_000_000), runEarnedScore: gn(1e9 - 1),
      equipmentCounts: { ...first.equipmentCounts, deepDrill: 10, refinery: 10 } };
    second = configureAutomation(second, { ...second.automation, enabled: true, policy: 'balanced' });
    expect(getNextAutomaticPurchaseSeconds(second)).toBe(0);
    const researched = performDeepResearch({ ...second, runEarnedScore: gn(1e9) });
    expect(advanceGame(researched, 0).equipmentCounts).toEqual(second.equipmentCounts);
  });
  it.each([1650, 16500])('quotes individually rounded prices near 1e100/1e1000 at ownership %s', (owned) => {
    const permanent = createInitialPermanent();
    const price = getEquipmentPrice('worker', owned, permanent);
    expect(price.gt(owned === 1650 ? '1e100' : '1e1000')).toBe(true);
    const budget = price.multiply(4);
    const quote = quoteEquipmentPurchase('worker', owned, budget, permanent);
    expect(quote.quantity).toBe(3);
    const sum = [0, 1, 2].reduce((amount, offset) => amount.add(getEquipmentPrice('worker', owned + offset, permanent)), gn(0));
    expect(quote.totalCost.equals(sum)).toBe(true);
    expect(quote.totalCost.lte(budget)).toBe(true);
    expect(quote.totalCost.add(getEquipmentPrice('worker', owned + 3, permanent)).gt(budget)).toBe(true);
    expect(quoteEquipmentPurchase('worker', owned, price.multiply('0.9999999999'), permanent).quantity).toBe(0);
    expect(() => JSON.stringify(encodeGameNumbers(quote))).not.toThrow();
  });

  it('stops an oversized MAX quote without exposing a partial purchase', () => {
    expect(() => quoteEquipmentPurchase('worker', 0, gn('gn1:1:2:20'), createInitialPermanent())).toThrow(NumericProgressError);
    expect(() => getEquipmentPrice('worker', Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => quoteEquipmentPurchase('worker', Number.MAX_SAFE_INTEGER - 1, gn('gn1:1:2:20'), createInitialPermanent())).toThrow(NumericProgressError);
  }, 15_000);

  it('keeps native prestige counters safe and preserves the save when a counter cannot advance', () => {
    const state = { ...createInitialState(), imo: gn(1e6), runEarnedScore: gn(1e6),
      permanent: { ...createInitialPermanent(), prestigeCount: Number.MAX_SAFE_INTEGER - 1, unspentPoints: Number.MAX_SAFE_INTEGER - 1 } };
    expect(() => prestigeGame(state)).toThrow(NumericProgressError);
    let raw = serializeSave(createSave(state, 0));
    const original = raw;
    const session = new GameSession({ getItem: () => raw, setItem: (_key, value) => { raw = value; } }, { wallNow: () => 0, monotonicNow: () => 0 });
    session.start();
    expect(session.prestige(2)).toBe(false);
    expect(session.getSnapshot().status).toBe('unavailable');
    expect(session.getSnapshot().gameState.permanent).toEqual(state.permanent);
    expect(raw).toBe(original);
  });

  it('never grants purchase credit from a negative compensation remainder', () => {
    const initial = { ...createAutomationReadyState(), imo: gn('9.9999999999'), runEarnedScore: gn(100),
      productionRemainder: { score: gn(0), imo: gn(-1e-10) } };
    expect(getPurchaseQuote(initial, 'worker', 1).quantity).toBe(0);
    const on = configureAutomation(initial, { ...initial.automation, enabled: true });
    expect(advanceGame(on, 0).equipmentCounts.worker).toBe(0);
    expect(advanceGame(on, 1).equipmentCounts.worker).toBeGreaterThan(0);
    expect(() => createSave(advanceGame(on, 1), 0)).not.toThrow();
  });

  it('keeps compensation bounded at every quarter-second and persists it across reload', () => {
    const ready = performDeepResearch(createResearchReadyState(true));
    let state = configureAutomation(ready, { ...ready.automation, enabled: true });
    const initial = state;
    for (let i = 0; i < 1000; i += 1) {
      state = advanceGame(state, 0.25);
      expect(state.productionRemainder!.score.abs().lte(gn(1e12).multiply(32 * Number.EPSILON))).toBe(true);
      expect(state.productionRemainder!.imo.abs().lte(gn(1e12).multiply(32 * Number.EPSILON))).toBe(true);
      if (i === 500) state = parseSave(serializeSave(createSave(state, 0))).gameState;
    }
    const whole = advanceGame(initial, 250);
    expect(state.equipmentCounts).toEqual(whole.equipmentCounts);
    expect(state.researchRanks).toEqual(whole.researchRanks);
    expect(approximatelyEqual(state.imo, whole.imo, 1e-9, 1e-10)).toBe(true);
    expect(approximatelyEqual(getProductionPerSecond(state), getProductionPerSecond(whole), 1e-9, 1e-10)).toBe(true);
  });
});
