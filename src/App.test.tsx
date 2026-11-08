import { unlockGear } from './core/gear';
import { performRootRebirth } from './core/root';
// @vitest-environment jsdom
import { testAmount as gn } from './test/amounts';

import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createSave, parseSave, serializeSave } from './core/save';
import { createInitialState } from './core/state';
import { SAVE_STORAGE_KEY } from './features/save/SaveRepository';
import { advanceGame } from './core/game';
import { prestigeGame, purchaseSkill } from './core/prestige';
import type { GameState } from './core/state';
import { createRootRebirthReadyState, completeAnalyzedRootCycle, buyTestEnhancements, createNextRootAnalysisReadyState, createAutomationReadyState, createBreakthroughReadyState, createResearchReadyState, createRootConnectionReadyState } from './test/progress';
import { performRootConnection } from './core/rootConnection';
import { performDeepResearch } from './core/research';
import { performBreakthrough } from './core/breakthrough';

let now = 0;

it('exposes only owned modes, previews changes, saves custom presets and retains their selection on reload', () => {
  const root = performRootRebirth(createRootRebirthReadyState());
  seedGame(unlockGear({ ...root, runEarnedScore: gn(1e5) }, 'shovel'));
  let view = renderGame();
  expect(view.container.innerHTML).not.toMatch(/lens|drillBit|compass|rootCore|研究共鳴|根脈集中|地層破砕/);
  fireEvent.click(screen.getByText(/効果モード・プリセット — 現在:/));
  fireEvent.click(screen.getByRole('button', { name: 'DEPTH探索に切替' }));
  expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.permanent.gearModes.shovel).toBe('excavation');
  expect(screen.getByText(/効果モード・プリセット — 現在: DEPTH探索/)).toBeTruthy();
  fireEvent.click(screen.getByText('カスタムプリセット（3枠）'));
  fireEvent.change(screen.getByLabelText('枠1の名前'), { target: { value: '深度用' } });
  fireEvent.click(screen.getAllByRole('button', { name: '現在の構成を保存' })[0]!);
  fireEvent.change(screen.getByLabelText('強化スコップのモード'), { target: { value: 'balanced' } });
  expect(screen.getByText(/切替前 → 切替後:/)).toBeTruthy();
  expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.permanent.gearModes.shovel).toBe('excavation');
  fireEvent.click(screen.getByRole('button', { name: 'この構成を適用' }));
  expect(screen.getByText(/効果モード・プリセット — 現在: カスタム/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '適用を確認' }));
  fireEvent.click(screen.getByRole('button', { name: 'この構成を適用' }));
  view.unmount(); view = renderGame();
  expect(screen.getByText(/効果モード・プリセット — 現在: 深度用/)).toBeTruthy();
  expect(view.container.innerHTML).not.toMatch(/rootCore|compass|研究共鳴|根脈集中/);
});

beforeEach(() => {
  now = 0;
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000 + Math.floor(now));
  // jsdom にない dialog API だけを補い、実際のフォーカス制御は Edge で確認する。
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

function tickAfter(seconds: number) {
  act(() => {
    now += seconds * 1_000;
    vi.advanceTimersByTime(250);
  });
}

function renderGame() {
  return render(<StrictMode><App /></StrictMode>);
}

describe('research UI', () => {
  it('reveals gear in reached ROOT stages and retains unpaid names and paid passives after a run reset', () => {
    let view = renderGame();
    expect(view.container.innerHTML).not.toMatch(/強化スコップ|自動選別レンズ|古代ドリルビット|地脈コンパス|根源コア/);
    view.unmount();
    const root = performRootRebirth(createRootRebirthReadyState());
    const funded = { ...root, imo: gn(123), runEarnedScore: gn(1e5) }; seedGame(funded); view = renderGame();
    expect(screen.getByRole('button', { name: '強化スコップを恒久解禁' })).toBeTruthy();
    expect(view.container.innerHTML).not.toMatch(/自動選別レンズ|古代ドリルビット|地脈コンパス|根源コア|gear-lens|gear-compass/);
    expect(screen.getByLabelText('利用可能SCORE').textContent).toBe('100,000');
    fireEvent.click(screen.getByRole('button', { name: '強化スコップを恒久解禁' }));
    const bought = parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState;
    expect(bought).toEqual(unlockGear(funded, 'shovel'));
    expect(screen.getByLabelText('利用可能SCORE').textContent).toBe('0');
    expect(screen.getByLabelText('装備支出SCORE').textContent).toBe('100,000');
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('100,000');
    expect(screen.getByLabelText('所持芋').textContent).toBe('123');
    expect(screen.getByLabelText('有効な装備数').textContent).toBe('1');
    view.unmount();
    seedGame(advanceGame(performBreakthrough(createNextRootAnalysisReadyState(bought)), Number.MAX_VALUE)); view = renderGame();
    expect(screen.getByRole('button', { name: '自動選別レンズを恒久解禁' })).toBeTruthy();
    expect(view.container.innerHTML).not.toMatch(/古代ドリルビット|地脈コンパス|根源コア/);
    fireEvent.click(screen.getByRole('button', { name: '転生する' }));
    fireEvent.click(screen.getByRole('button', { name: '転生を実行（3pt）' }));
    expect(screen.getByLabelText('装備支出SCORE').textContent).toBe('0');
    expect(screen.getByLabelText('有効な装備数').textContent).toBe('1');
    expect((screen.getByRole('button', { name: '自動選別レンズを恒久解禁' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '強化スコップは恒久解禁済み' })).toBeTruthy();
  });

  it('keeps ROOT upgrades hidden until confirmed rebirth, saves one reward and remembers upgrades after normal prestige', () => {
    let view = renderGame();
    expect(view.container.innerHTML).not.toMatch(/原初の恵み|根源の記憶|地底への適応|装備システム/);
    view.unmount();
    const ready = createRootRebirthReadyState(); seedGame(ready); view = renderGame();
    expect(view.container.innerHTML).not.toMatch(/原初の恵み|根源の記憶|地底への適応|装備システム/);
    fireEvent.click(screen.getByRole('button', { name: 'ROOT REBIRTHする' }));
    expect(screen.getByRole('dialog').textContent).toMatch(/通常転生回数・通常ポイントは増えません/);
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState).toEqual(ready);
    fireEvent.click(screen.getByRole('button', { name: 'ROOT REBIRTHする' }));
    fireEvent.click(screen.getByRole('button', { name: 'ROOTを実行（結晶1個）' }));
    const reborn = parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState;
    expect(reborn.permanent.prestigeCount).toBe(0);
    expect(reborn.permanent.lifetimePrestigeCount).toBe(ready.permanent.lifetimePrestigeCount);
    expect(reborn.permanent.unspentPoints).toBe(0);
    expect(screen.getByLabelText('ROOT結晶').textContent).toBe('1');
    expect(screen.getByLabelText('ROOT回数').textContent).toBe('1');
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('0');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('3');
    expect(screen.getByRole('complementary', { name: '装備システム解禁' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'ROOT REBIRTHする' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /根源の記憶を強化/ }));
    expect(screen.getByLabelText('ROOT結晶').textContent).toBe('0');
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.permanent.rootUpgradeRanks.memory).toBe(1);
    view.unmount();
    const saved = parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState;
    seedGame(advanceGame(saved, Number.MAX_VALUE)); view = renderGame();
    fireEvent.click(screen.getByRole('button', { name: '転生する' }));
    fireEvent.click(screen.getByRole('button', { name: '転生を実行（2pt）' }));
    expect(screen.getByLabelText('ROOT回数').textContent).toBe('1');
    expect(screen.getByLabelText('ROOT結晶').textContent).toBe('0');
    expect(screen.getByLabelText('所持芋').textContent).toBe('100');
    expect(screen.getByRole('button', { name: /根源の記憶を強化/ })).toBeTruthy();
  });

  it('reveals origin devices/research after confirmation, keeps discovery after prestige, and enables ROOT only at 1e18', () => {
    let view = renderGame();
    expect(view.container.innerHTML).not.toMatch(/根源採掘機|芋核炉|根源収穫学|芋核共鳴|originMiner|imoReactor|ROOT REBIRTH/);
    view.unmount();
    seedGame(advanceGame(performRootConnection(createRootConnectionReadyState(true)), Number.MAX_VALUE));
    view = renderGame();
    expect(view.container.innerHTML).not.toMatch(/根源採掘機|芋核炉|根源収穫学|芋核共鳴|originMiner|imoReactor|ROOT REBIRTH/);
    fireEvent.click(screen.getByRole('button', { name: '地底核心の解析' }));
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.scoreCapStage).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: '地底核心の解析' }));
    fireEvent.click(screen.getByRole('button', { name: '無料で地底核心を解析' }));
    const discovered = parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState;
    expect(screen.getByLabelText('SCORE上限').textContent).toBe('1E18');
    expect(screen.getByRole('article', { name: '根源採掘機' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /芋核共鳴を強化/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'ROOT REBIRTHする' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '転生する' }));
    fireEvent.click(screen.getByRole('button', { name: '転生を実行（5pt）' }));
    expect(screen.getByRole('article', { name: '芋核炉' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '芋核炉を購入' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /根源収穫学を強化/ }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
    seedGame({ ...discovered, runEarnedScore: gn(1e18), imo: gn(1e18) }); renderGame();
    expect(screen.getByText(/ROOT REBIRTH可能/)).toBeTruthy();
    expect(screen.getByLabelText('収穫速度').textContent).toBe('0');
    expect(screen.getByRole('button', { name: '転生する' })).toBeTruthy();
  });

  it('hides undiscovered strata/rewards/research, reveals only reached content, and preserves paid digging upgrades on prestige', () => {
    let view = renderGame();
    expect(screen.getByLabelText('DEPTH').textContent).toBe('0');
    expect(view.container.innerHTML).not.toMatch(/粘土層|岩盤層|地脈層|根脈層|根源領域|基本掘削研究|地脈掘削研究|連携掘削補助/);
    expect(screen.getByText(/次の発見 ？？？ まで 10 m/)).toBeTruthy();
    tickAfter(401);
    expect(screen.getByText(/粘土層を発見しました/)).toBeTruthy();
    view.unmount(); view = renderGame();
    expect(screen.queryByText(/粘土層を発見しました/)).toBeNull();
    view.unmount();
    const initial = createInitialState();
    seedGame({ ...initial, imo: gn(1e5), runEarnedScore: gn(1e5), permanent: { ...initial.permanent, depthMeters: 100 } });
    view = renderGame();
    expect(screen.getByText('岩盤層', { selector: 'strong' })).toBeTruthy();
    expect(view.container.innerHTML).not.toMatch(/地脈層|根脈層|根源領域|地脈掘削研究|連携掘削補助/);
    fireEvent.click(screen.getByText('掘削研究（任意・恒久）'));
    fireEvent.click(screen.getByRole('button', { name: /基本掘削研究を強化/ }));
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.permanent.digResearchRanks.basic).toBe(1);
    expect(screen.getByLabelText('所持芋').textContent).toBe('90,000');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '転生する' })); fireEvent.click(screen.getByRole('button', { name: '転生を実行（1pt）' }));
    expect(screen.getByLabelText('DEPTH').textContent).toBe('100');
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.permanent.digResearchRanks.basic).toBe(1);
  });

  it('keeps undiscovered root devices out of HTML/settings, reveals them only on confirmed discovery and retains names after prestige', () => {
    const initial = createInitialState(); seedGame({ ...initial, automation: { ...initial.automation, policy: 'priority' } });
    let view = renderGame();
    expect(view.container.innerHTML).not.toMatch(/根脈中継塔|芋核培養槽|rootRelay|coreChamber/);
    expect(screen.queryByRole('button', { name: '根脈接続解析' })).toBeNull();
    view.unmount();
    const ready = createRootConnectionReadyState(true); seedGame({ ...ready, automation: { ...ready.automation, policy: 'priority' } });
    view = renderGame();
    expect(view.container.innerHTML).not.toMatch(/根脈中継塔|芋核培養槽|rootRelay|coreChamber/);
    expect(screen.getByText('次の発見: ？？？')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '根脈接続解析' }));
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.scoreCapStage).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: '根脈接続解析' }));
    fireEvent.click(screen.getByRole('button', { name: '無料で根脈接続を実行' }));
    const connected = parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState;
    expect(connected.permanent.maxDiscoveredStage).toBe(3);
    expect(connected.permanent.deepResearchCount).toBe(1);
    expect(screen.getByRole('article', { name: '根脈中継塔' })).toBeTruthy();
    expect(screen.getByLabelText('SCORE上限').textContent).toBe('1E15');
    view.unmount();
    const funded = { ...connected, imo: gn(8e14), runEarnedScore: gn(9e14) }; seedGame(funded); view = renderGame();
    fireEvent.click(screen.getByRole('button', { name: '根脈中継塔を1台購入' }));
    fireEvent.click(screen.getByRole('button', { name: '根脈中継塔を1台購入' }));
    fireEvent.click(screen.getByRole('button', { name: '芋核培養槽を1台購入' }));
    expect(screen.getByLabelText('設備連携の組数').textContent).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '転生する' })); fireEvent.click(screen.getByRole('button', { name: '転生を実行（4pt）' }));
    expect(screen.getByRole('article', { name: '芋核培養槽' })).toBeTruthy();
    expect(screen.getByText('この周回は上限段階の再突破が必要です。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '根脈中継塔を購入' }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
    seedGame(advanceGame(performRootConnection(ready), Number.MAX_VALUE)); renderGame();
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('1E15');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('0');
    expect((screen.getByRole('button', { name: '芋核培養槽を購入' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets the third analysis retain starting supplies and updates the preview before confirmation', () => {
    let ready = createRootRebirthReadyState();
    for (let count = 0; count < 2; count += 1) {
      ready = performRootRebirth(ready);
      ready = buyTestEnhancements(ready, { harvest: 3, discount: 1, startingImo: 1 });
      ready = createNextRootAnalysisReadyState(ready);
      if (count === 0) ready = completeAnalyzedRootCycle(performDeepResearch(ready));
    }
    seedGame(ready); renderGame();
    fireEvent.click(screen.getByRole('button', { name: '研究による突破' }));
    const dialog = screen.getByRole('dialog', { name: /深層記憶/ });
    fireEvent.change(within(dialog).getByLabelText('豊かな収穫に加えて保持する強化スキル'), { target: { value: 'startingImo' } });
    expect(within(dialog).getByText(/失う強化スキル: 設備の目利き ランク1→0/)).toBeTruthy();
    expect(within(dialog).getByText(/保持する種類: 豊かな収穫.*旅立ちの蓄え/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '無料で研究突破を実行' }));
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState).toEqual(performDeepResearch(ready, 'startingImo'));
    expect((screen.getByRole('button', { name: '設備の目利きを強化' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps research locked before 1e9 and confirms the skill reset separately from prestige', () => {
    seedGame(performBreakthrough(createBreakthroughReadyState()));
    const view = renderGame();
    expect((screen.getByRole('button', { name: '研究による突破' }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
    const ready = createResearchReadyState(); seedGame(ready); renderGame();
    fireEvent.click(screen.getByRole('button', { name: '研究による突破' }));
    let dialog = screen.getByRole('dialog', { name: /研究による突破：深層記憶/ });
    expect(within(dialog).getByText(/豊かな収穫 ランク3→0/)).toBeTruthy();
    expect(within(dialog).getByText('7pt')).toBeTruthy();
    expect(within(dialog).getByText(/この周回では強化型スキルを再購入できません/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.scoreCapStage).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '研究による突破' }));
    dialog = screen.getByRole('dialog', { name: /SCORE 1E9→1E12/ });
    fireEvent.click(within(dialog).getByRole('button', { name: '無料で研究突破を実行' }));
    const state = parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState;
    expect(state).toEqual(performDeepResearch(ready));
    expect(screen.getByLabelText('SCORE上限').textContent).toBe('1E12');
    expect((screen.getByRole('button', { name: '研究による突破' }) as HTMLButtonElement).disabled).toBe(true);
    tickAfter(1);
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.imo).toBeAmount(ready.imo);
    expect(screen.getByLabelText('収穫速度').textContent).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '転生する' }));
    expect(screen.getByRole('dialog').textContent).toContain('SCORE 0・上限1E12（段階2）から再開');
    fireEvent.click(screen.getByRole('button', { name: '転生を実行（3pt）' }));
    const inherited = parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState;
    expect(inherited.scoreCapStage).toBe(2); expect(inherited.runEarnedScore).toBeAmount(0);
    expect(inherited.permanent.deepResearchCount).toBe(1);
    expect(inherited.postDeepResearchSkillLock).toBe(false);
    expect(screen.getByLabelText('SCORE上限').textContent).toBe('1E12');
    expect((screen.getByRole('button', { name: '研究による突破' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '豊かな収穫を強化' }));
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.permanent.skillRanks.harvest).toBe(1);
  });

  it('purchases and refunds research, unlocks new devices, and explains the 1e12 stop', () => {
    const ready = performDeepResearch(createResearchReadyState()); seedGame(ready);
    const view = renderGame();
    fireEvent.click(screen.getByRole('button', { name: /地層収穫学を強化/ }));
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.researchRanks.geology).toBe(1);
    expect(screen.getByLabelText('収穫速度').textContent).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: /研究強化を振り直す/ }));
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.imo).toBeAmount(ready.imo);
    fireEvent.click(screen.getByRole('button', { name: '地脈抽出機を1台購入' }));
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.equipmentCounts.veinExtractor).toBe(1);
    view.unmount();
    seedGame(advanceGame(ready, Number.MAX_VALUE)); renderGame();
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('1E12');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('0');
    expect(within(screen.getByRole('region', { name: '採掘' })).getByText(/根脈接続解析で、転生せずに上限1E15/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /地層収穫学を強化/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('minimal mining game', () => {
  it('shows the initial balance, rate, score, labelled gauge, and equipment', () => {
    renderGame();

    expect(screen.getByRole('heading', { name: 'IMO DEPTH' })).toBeTruthy();
    expect(screen.getByLabelText('所持芋').textContent).toBe('0');
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('0');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('1');
    const progress = screen.getByRole('progressbar', { name: 'SCORE' }) as HTMLProgressElement;
    expect(progress.value).toBe(0);
    expect(progress.max).toBe(1);
    expect(within(screen.getByRole('region', { name: '設備' })).getAllByRole('article')).toHaveLength(7);
    for (const button of within(screen.getByRole('region', { name: '設備' })).getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getAllByText('所持芋が足りません。')).toHaveLength(3);
    expect(screen.getByText(/このブラウザに自動保存します/)).toBeTruthy();
  });

  it('uses real elapsed time when a timer callback arrives late', () => {
    renderGame();
    tickAfter(45.5);

    expect(screen.getByLabelText('所持芋').textContent).toBe('45.5');
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('45.5');
    expect(screen.getByText(/作業員を購入できます/)).toBeTruthy();
  });

  it.each([
    ['×1', 100, '1', '90', '2'],
    ['×10', 100, '6', '9', '7'],
    ['MAX', 1_000, '19', '108', '21.9'],
  ])('buys with %s and immediately updates the balance, score, count and rate', (mode, elapsed, count, balance, rate) => {
    renderGame();
    tickAfter(Number(elapsed));
    fireEvent.click(screen.getByRole('radio', { name: mode }));
    const worker = screen.getByRole('article', { name: '作業員' });
    fireEvent.click(within(worker).getByRole('button'));

    expect(screen.getByLabelText('作業員の所有数').textContent).toBe(count);
    expect(screen.getByLabelText('所持芋').textContent).toBe(balance);
    expect(screen.getByLabelText('現在SCORE').textContent).toBe(elapsed === 1_000 ? '1,000' : '100');
    expect(screen.getByLabelText('収穫速度').textContent).toBe(rate);
    if (mode === '×1') {
      expect(within(worker).getAllByText('12 芋')).toHaveLength(2);
    }
    tickAfter(1);
    const displayed = Number(screen.getByLabelText('所持芋').textContent!.replaceAll(',', ''));
    // 通貨は小数1桁切捨て。倍率の浮動小数点端数も表示桁の範囲で許容する。
    expect(Math.abs(displayed - Number(balance) - Number(rate))).toBeLessThanOrEqual(0.1 + 1e-8);
  });

  it('connects the other equipment buttons to their corresponding core definitions', () => {
    renderGame();
    tickAfter(2_000);
    fireEvent.click(within(screen.getByRole('article', { name: '運搬車' })).getByRole('button'));
    fireEvent.click(within(screen.getByRole('article', { name: '自動収穫機' })).getByRole('button'));

    expect(screen.getByLabelText('運搬車の所有数').textContent).toBe('1');
    expect(screen.getByLabelText('自動収穫機の所有数').textContent).toBe('1');
    expect(screen.getByLabelText('所持芋').textContent).toBe('900');
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('2,000');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('111');
    expect(within(screen.getByRole('article', { name: '運搬車' })).getAllByText('120 芋')).toHaveLength(2);
    expect(within(screen.getByRole('article', { name: '自動収穫機' })).getByText('1,250 芋')).toBeTruthy();
  });

  it('settles time before the purchase at the old rate, then uses the new rate', () => {
    renderGame();
    tickAfter(10);
    now += 500;
    fireEvent.click(screen.getByRole('button', { name: '作業員を1台購入' }));

    expect(screen.getByLabelText('所持芋').textContent).toBe('0.5');
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('10.5');
    tickAfter(1);
    expect(screen.getByLabelText('所持芋').textContent).toBe('2.5');
  });

  it('keeps one timer through StrictMode, purchases, and rerenders, then cleans up', () => {
    const view = renderGame();
    expect(vi.getTimerCount()).toBe(1);
    tickAfter(10);
    fireEvent.click(screen.getByRole('button', { name: '作業員を1台購入' }));
    view.rerender(<StrictMode><App /></StrictMode>);
    expect(vi.getTimerCount()).toBe(1);
    tickAfter(1);
    expect(screen.getByLabelText('所持芋').textContent).toBe('2');

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    renderGame();
    expect(screen.getByLabelText('所持芋').textContent).toBe('2');
    expect(screen.getByLabelText('作業員の所有数').textContent).toBe('1');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('supports keyboard mode selection and buying without a mouse', async () => {
    const user = userEvent.setup();
    renderGame();
    tickAfter(100);

    await user.tab();
    expect(document.activeElement?.tagName).toBe('SUMMARY');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '×1' }));
    await user.keyboard('{ArrowRight}');
    expect((screen.getByRole('radio', { name: '×10' }) as HTMLInputElement).checked).toBe(true);
    await user.keyboard('{ArrowRight}');
    expect((screen.getByRole('radio', { name: 'MAX' }) as HTMLInputElement).checked).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '作業員を6台購入' }));
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('作業員の所有数').textContent).toBe('6');
    expect(screen.getByLabelText('所持芋').textContent).toBe('9');
  });

  it('fills the gauge at the cap, shows zero actual production, and stops purchases', () => {
    renderGame();
    tickAfter(10);
    fireEvent.click(screen.getByRole('button', { name: '作業員を1台購入' }));
    tickAfter(1_000_000);

    expect(screen.getByLabelText('現在SCORE').textContent).toBe('1,000,000');
    expect(screen.getByLabelText('所持芋').textContent).toBe('999,990');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('0');
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(1);
    expect(screen.getByText('上限到達 — 収穫が停止しました')).toBeTruthy();
    expect(screen.getByText(/転生で2ptを獲得し/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '転生する' }) as HTMLButtonElement).disabled).toBe(false);
    for (const button of within(screen.getByRole('region', { name: '設備' })).getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    tickAfter(100);
    expect(screen.getByLabelText('所持芋').textContent).toBe('999,990');
    expect(screen.getByLabelText('作業員の所有数').textContent).toBe('1');
  });

  it('does not spend imo if the cap is reached between the last tick and a click', () => {
    renderGame();
    tickAfter(999_999);
    now += 2_000;
    fireEvent.click(screen.getByRole('button', { name: '作業員を1台購入' }));

    expect(screen.getByLabelText('所持芋').textContent).toBe('1,000,000');
    expect(screen.getByLabelText('作業員の所有数').textContent).toBe('0');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('0');
  });
});

function openSavePanel() {
  fireEvent.click(screen.getByText(/^セーブ管理/));
}

describe('save management UI', () => {
  it('loads one hour of offline rewards once under StrictMode and reports the result', () => {
    localStorage.setItem(SAVE_STORAGE_KEY, serializeSave(createSave(createInitialState(), Date.now() - 3_600_000)));
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    renderGame();

    expect(writes).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('所持芋').textContent).toBe('3,600');
    const report = screen.getByRole('region', { name: 'おかえりなさい' });
    expect(within(report).getAllByText('1時間 0分')).toHaveLength(2);
    expect(within(report).getByText('3,600 芋')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '放置報酬の報告を閉じる' }));
    expect(screen.queryByRole('region', { name: 'おかえりなさい' })).toBeNull();
    tickAfter(1);
    expect(screen.getByLabelText('所持芋').textContent).toBe('3,601');
  });

  it.each(['', 'broken', '{"saveVersion":0}'])('keeps current game and save on invalid import %s', (text) => {
    renderGame();
    tickAfter(100);
    openSavePanel();
    const original = localStorage.getItem(SAVE_STORAGE_KEY);
    fireEvent.change(screen.getByLabelText('インポートするセーブテキスト'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'インポート内容を確認' }));

    expect(screen.getByRole('alert').textContent).toContain('現在の進行とセーブは保持');
    expect(screen.getByLabelText('所持芋').textContent).toBe('100');
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBe(original);
    expect(screen.queryByRole('button', { name: 'このセーブに置き換える' })).toBeNull();
  });

  it('exports, previews, cancels, and restores the exact exported state only after confirmation', () => {
    renderGame();
    tickAfter(100);
    fireEvent.click(screen.getByRole('button', { name: '作業員を1台購入' }));
    openSavePanel();
    fireEvent.click(screen.getByRole('button', { name: 'セーブをエクスポート' }));
    const exported = (screen.getByLabelText('エクスポート用セーブ（全選択してコピー）') as HTMLTextAreaElement).value;
    tickAfter(10);
    expect(screen.getByLabelText('所持芋').textContent).toBe('110');
    fireEvent.change(screen.getByLabelText('インポートするセーブテキスト'), { target: { value: exported } });
    fireEvent.click(screen.getByRole('button', { name: 'インポート内容を確認' }));
    expect(screen.getByRole('group', { name: 'インポートの確認' })).toBeTruthy();
    expect(screen.getByLabelText('所持芋').textContent).toBe('110');
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.getByLabelText('所持芋').textContent).toBe('110');
    fireEvent.click(screen.getByRole('button', { name: 'インポート内容を確認' }));
    fireEvent.click(screen.getByRole('button', { name: 'このセーブに置き換える' }));

    expect(screen.getByLabelText('所持芋').textContent).toBe('90');
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('100');
    expect(screen.getByLabelText('作業員の所有数').textContent).toBe('1');
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState).toEqual(parseSave(exported).gameState);
  });

  it('requires confirmation for reset and leaves data intact when cancelled', () => {
    renderGame();
    tickAfter(100);
    openSavePanel();
    const original = localStorage.getItem(SAVE_STORAGE_KEY);
    fireEvent.click(screen.getByRole('button', { name: 'セーブを初期化' }));
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.getByLabelText('所持芋').textContent).toBe('100');
    fireEvent.click(screen.getByRole('button', { name: 'セーブを初期化' }));
    fireEvent.click(screen.getByRole('button', { name: '初期化を実行' }));

    expect(screen.getByLabelText('所持芋').textContent).toBe('0');
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState).toEqual(createInitialState());
    tickAfter(1);
    expect(screen.getByLabelText('所持芋').textContent).toBe('1');
  });

  it('does not overwrite a corrupt save and lets the user export the original before recovery', () => {
    localStorage.setItem(SAVE_STORAGE_KEY, 'broken original');
    renderGame();
    tickAfter(100);
    expect(screen.getByRole('alert').textContent).toContain('元データを保持');
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBe('broken original');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('0');
    openSavePanel();
    fireEvent.click(screen.getByRole('button', { name: 'セーブをエクスポート' }));
    expect((screen.getByLabelText('エクスポート用セーブ（全選択してコピー）') as HTMLTextAreaElement).value).toBe('broken original');
    fireEvent.click(screen.getByRole('button', { name: 'セーブを初期化' }));
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBe('broken original');
    fireEvent.click(screen.getByRole('button', { name: '初期化を実行' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('収穫速度').textContent).toBe('1');
  });

  it('handles visibilitychange and pagehide/pageshow without double settlement', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    renderGame();
    tickAfter(5);
    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('pagehide'));
    tickAfter(48 * 3_600);
    expect(screen.getByLabelText('所持芋').textContent).toBe('5');
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('pageshow'));

    expect(screen.getByLabelText('所持芋').textContent).toBe('86,405');
    const report = screen.getByRole('region', { name: 'おかえりなさい' });
    expect(within(report).getByText('48時間 0分')).toBeTruthy();
    expect(within(report).getByText('24時間 0分')).toBeTruthy();
    tickAfter(1);
    expect(screen.getByLabelText('所持芋').textContent).toBe('86,406');
  });

  it('pauses and warns on a competing storage change without overwriting it', () => {
    renderGame();
    tickAfter(100);
    const external = serializeSave(createSave(createInitialState(), Date.now()));
    localStorage.setItem(SAVE_STORAGE_KEY, external);
    fireEvent(window, new StorageEvent('storage', { key: SAVE_STORAGE_KEY, newValue: external }));
    tickAfter(100);

    expect(screen.getByRole('alert').textContent).toContain('別のタブ');
    expect(screen.getByLabelText('所持芋').textContent).toBe('100');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('0');
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBe(external);
    for (const button of within(screen.getByRole('region', { name: '設備' })).getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('keeps current state and original save if an import write fails', () => {
    renderGame();
    tickAfter(100);
    openSavePanel();
    const original = localStorage.getItem(SAVE_STORAGE_KEY);
    fireEvent.change(screen.getByLabelText('インポートするセーブテキスト'), { target: { value: serializeSave(createSave(createInitialState(), Date.now())) } });
    fireEvent.click(screen.getByRole('button', { name: 'インポート内容を確認' }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota exceeded', 'QuotaExceededError'); });
    fireEvent.click(screen.getByRole('button', { name: 'このセーブに置き換える' }));

    expect(screen.getByRole('alert').textContent).toContain('保存領域の読み書きに失敗');
    expect(screen.getByLabelText('所持芋').textContent).toBe('100');
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBe(original);
  });
});

function seedGame(state: GameState) {
  localStorage.setItem(SAVE_STORAGE_KEY, serializeSave(createSave(state, Date.now())));
}

function confirmPrestige(points: number) {
  fireEvent.click(screen.getByRole('button', { name: '転生する' }));
  fireEvent.click(screen.getByRole('button', { name: `転生を実行（${points}pt）` }));
}

describe('equipment growth UI', () => {
  it('announces 9->10 once and immediately updates the next goal and rate', () => {
    seedGame({ ...createInitialState(), imo: gn(100), runEarnedScore: gn(1_000),
      equipmentCounts: { ...createInitialState().equipmentCounts, worker: 9 } });
    renderGame();
    expect(screen.queryByText(/マイルストーン達成/)).toBeNull();
    const worker = screen.getByRole('article', { name: '作業員' });
    expect(within(worker).getByText(/次の目標 10台/)).toBeTruthy();
    fireEvent.click(within(worker).getByRole('button'));
    expect(screen.getByLabelText('作業員の所有数').textContent).toBe('10');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('12');
    expect(within(worker).getByText(/次の目標 25台 → ×1.265/)).toBeTruthy();
    expect(screen.getAllByText(/マイルストーン達成！/)).toHaveLength(1);
    tickAfter(1);
    expect(screen.getAllByText(/マイルストーン達成！/)).toHaveLength(1);
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.equipmentCounts.worker).toBe(10);
  });

  it('shows current/next cumulative multipliers around 25 and 50 units', () => {
    for (const [count, next, current] of [[24, 25, '1.1'], [49, 50, '1.265']] as const) {
      seedGame({ ...createInitialState(), imo: gn(200_000), runEarnedScore: gn(200_000),
        equipmentCounts: { ...createInitialState().equipmentCounts, worker: count } });
      const view = renderGame();
      const worker = screen.getByRole('article', { name: '作業員' });
      expect(within(worker).getByText(new RegExp(`台数倍率 ×${current}`))).toBeTruthy();
      expect(within(worker).getByText(new RegExp(`次の目標 ${next}台`))).toBeTruthy();
      fireEvent.click(within(worker).getByRole('button'));
      expect(screen.getByLabelText('作業員の所有数').textContent).toBe(String(next));
      expect(screen.getByText(new RegExp(`${next}台のマイルストーン達成`))).toBeTruthy();
      view.unmount();
    }
  });

  it('keeps both higher equipment locked through MAX and cap arrival', () => {
    renderGame();
    fireEvent.click(screen.getByRole('radio', { name: 'MAX' }));
    tickAfter(1_000_000);
    for (const name of ['深層掘削機', '芋精製プラント']) {
      const row = screen.getByRole('article', { name });
      const button = within(row).getByRole('button');
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.textContent).toBe('未解禁');
      expect(within(row).getByText(/SCORE 上限 1E9/)).toBeTruthy();
      fireEvent.click(button);
      expect(screen.getByLabelText(`${name}の所有数`).textContent).toBe('0');
    }
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('1,000,000');
  });
});

describe('automation UI', () => {
  function openAutomation() { fireEvent.click(screen.getByText(/自動購入: OFF/)); }

  it('locks settings before acquisition, buys the skill with no immediate spending, and defaults OFF', () => {
    seedGame(purchaseSkill(prestigeGame(advanceGame(createInitialState(), 1e6)), 'harvest'));
    renderGame(); openAutomation();
    // fieldset由来の無効化はDOMのdisabledプロパティではなく :disabled で評価する。
    expect(screen.getByRole('checkbox', { name: '自動購入を有効にする' }).matches(':disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '自動設備管理を強化' }));
    expect(screen.getByRole('checkbox', { name: '自動購入を有効にする' }).matches(':disabled')).toBe(false);
    expect((screen.getByRole('checkbox', { name: '自動購入を有効にする' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByLabelText('自動設備管理のランク').textContent).toBe('1');
    expect(screen.getByLabelText('作業員の所有数').textContent).toBe('0');
  });

  it('persists policy, equipment switches, priority swaps and immediate ON/OFF', () => {
    seedGame({ ...createAutomationReadyState(), imo: gn(100), runEarnedScore: gn(100) });
    const view = renderGame(); openAutomation();
    fireEvent.change(screen.getByRole('combobox', { name: '購入方針' }), { target: { value: 'priority' } });
    fireEvent.change(screen.getByRole('combobox', { name: '第1優先の設備' }), { target: { value: 'harvester' } });
    expect((screen.getByRole('combobox', { name: '第3優先の設備' }) as HTMLSelectElement).value).toBe('worker');
    fireEvent.click(screen.getByRole('checkbox', { name: '運搬車の自動購入' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '自動購入を有効にする' }));
    expect(screen.getByLabelText('作業員の所有数').textContent).toBe('6');
    expect(screen.getByLabelText('運搬車の所有数').textContent).toBe('0');
    expect(screen.getByLabelText('直近の自動購入台数').textContent).toBe('6');
    const state = parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState;
    expect(state.automation.priority[0]).toBe('harvester'); expect(state.automation.equipment.cart).toBe(false);
    view.unmount(); renderGame(); fireEvent.click(screen.getByText(/自動購入: ON/));
    expect((screen.getByRole('combobox', { name: '購入方針' }) as HTMLSelectElement).value).toBe('priority');
    fireEvent.click(screen.getByRole('checkbox', { name: '自動購入を有効にする' }));
    tickAfter(60); expect(screen.getByLabelText('作業員の所有数').textContent).toBe('6');
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.automation.enabled).toBe(false);
  });

  it('keeps settings OFF and reports a save error when applying ON fails', () => {
    seedGame({ ...createAutomationReadyState(), imo: gn(100), runEarnedScore: gn(100) }); renderGame(); openAutomation();
    const before = localStorage.getItem(SAVE_STORAGE_KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    fireEvent.click(screen.getByRole('checkbox', { name: '自動購入を有効にする' }));
    expect((screen.getByRole('checkbox', { name: '自動購入を有効にする' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByLabelText('作業員の所有数').textContent).toBe('0');
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBe(before);
    expect(screen.getByRole('alert').textContent).toContain('保存領域');
  });
});

describe('breakthrough UI', () => {
  it('offers prestige when locked and explains skill prerequisites', () => {
    seedGame(advanceGame(createInitialState(), 1e6)); renderGame();
    expect((screen.getByRole('button', { name: '限界突破する' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '転生する' }) as HTMLButtonElement).disabled).toBe(false);
    const node = screen.getByRole('article', { name: '限界突破の心得' });
    expect(within(node).getByText(/収穫 ランク3.*目利き ランク1.*転生5回/)).toBeTruthy();
    expect(within(node).getByText('3ptで強化')).toBeTruthy();
    expect(screen.getByText(/スキルを強化して限界突破を解禁/)).toBeTruthy();
  });

  it('cancels then performs a no-reset breakthrough once, resumes production and survives reload', () => {
    const state = { ...createBreakthroughReadyState(), imo: gn(1234),
      equipmentCounts: { ...createInitialState().equipmentCounts, worker: 10 } };
    seedGame(state); const view = renderGame();
    const trigger = screen.getByRole('button', { name: '限界突破する' });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '転生する' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '転生せずに限界突破しますか？' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState).toEqual(state);
    fireEvent.click(trigger); fireEvent.click(screen.getByRole('button', { name: '限界突破を実行' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState).toEqual(performBreakthrough(state));
    expect((screen.getByRole('progressbar', { name: 'SCORE' }) as HTMLProgressElement).max).toBe(1);
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('1,000,000');
    expect(screen.getByLabelText('所持芋').textContent).toBe('1,234');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('30');
    tickAfter(1);
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('1,000,030');
    view.unmount(); renderGame();
    expect((screen.getByRole('progressbar', { name: 'SCORE' }) as HTMLProgressElement).max).toBe(1);
    expect((screen.getByRole('button', { name: '限界突破する' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/次は地層研究の深層解析/)).toBeTruthy();
  });

  it('keeps the dialog and capped state if saving the transition fails', () => {
    seedGame(createBreakthroughReadyState()); renderGame();
    fireEvent.click(screen.getByRole('button', { name: '限界突破する' }));
    const raw = localStorage.getItem(SAVE_STORAGE_KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    fireEvent.click(screen.getByRole('button', { name: '限界突破を実行' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByRole('progressbar', { name: 'SCORE' }) as HTMLProgressElement).max).toBe(1);
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBe(raw);
    expect(screen.getByText(/限界突破できませんでした/)).toBeTruthy();
  });

  it('unlocks both higher equipment, stops at 1e9 and resets only the run on prestige', () => {
    const state = { ...performBreakthrough(createBreakthroughReadyState()), imo: gn(100_000_000), runEarnedScore: gn(100_000_000) };
    seedGame(state); renderGame();
    for (const name of ['深層掘削機', '芋精製プラント']) {
      const button = within(screen.getByRole('article', { name })).getByRole('button');
      expect((button as HTMLButtonElement).disabled).toBe(false); fireEvent.click(button);
      expect(screen.getByLabelText(`${name}の所有数`).textContent).toBe('1');
    }
    tickAfter(1e9);
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('1E9');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('0');
    expect(within(screen.getByRole('region', { name: '採掘' })).getByText(/SCORE 1E9到達/)).toBeTruthy();
    confirmPrestige(3);
    expect((screen.getByRole('progressbar', { name: 'SCORE' }) as HTMLProgressElement).max).toBe(1);
    expect(screen.getByLabelText('限界突破の心得のランク').textContent).toBe('1');
    expect(screen.getByLabelText('深層掘削機の所有数').textContent).toBe('0');
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.scoreCapStage).toBe(0);
  });
});

describe('prestige and skill UI', () => {
  it.each([[99_999, '0', true], [100_000, '1', false], [999_999, '1', false], [1_000_000, '2', false]] as const)(
    'previews the reward at SCORE %s', (score, reward, disabled) => {
      seedGame({ ...createInitialState(), imo: gn(score), runEarnedScore: gn(score) });
      renderGame();
      expect(screen.getByLabelText('獲得見込みポイント').textContent).toBe(reward);
      expect((screen.getByRole('button', { name: '転生する' }) as HTMLButtonElement).disabled).toBe(disabled);
    },
  );

  it('cancels without resetting, then confirms exactly one reset and reward under StrictMode', () => {
    seedGame({ ...createInitialState(), imo: gn(90_000), runEarnedScore: gn(100_000), equipmentCounts: { ...createInitialState().equipmentCounts, worker: 3, cart: 1, harvester: 0 } });
    renderGame();
    fireEvent.click(screen.getByRole('button', { name: '転生する' }));
    expect(screen.getByRole('dialog', { name: '転生して次の周回へ進みますか？' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.getByLabelText('所持芋').textContent).toBe('90,000');
    expect(screen.getByLabelText('作業員の所有数').textContent).toBe('3');
    confirmPrestige(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('所持芋').textContent).toBe('0');
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('0');
    expect(screen.getByLabelText('作業員の所有数').textContent).toBe('0');
    expect(screen.getByLabelText('累計転生回数').textContent).toBe('1');
    expect(screen.getByLabelText('未使用ポイント').textContent).toBe('1');
    expect(screen.getByText(/転生しました。1pt/)).toBeTruthy();
    expect(parseSave(localStorage.getItem(SAVE_STORAGE_KEY)!).gameState.permanent.unspentPoints).toBe(1);
  });

  it('completes a capped run, buys harvest and discount, and immediately displays their effects', () => {
    seedGame(advanceGame(createInitialState(), 1_000_000));
    renderGame();
    confirmPrestige(2);
    fireEvent.click(screen.getByRole('button', { name: '豊かな収穫を強化' }));
    expect(screen.getByLabelText('収穫速度').textContent).toBe('1.5');
    expect(screen.getByLabelText('未使用ポイント').textContent).toBe('1');
    expect(screen.getByLabelText('豊かな収穫のランク').textContent).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '設備の目利きを強化' }));
    expect(screen.getByLabelText('未使用ポイント').textContent).toBe('0');
    expect(within(screen.getByRole('article', { name: '作業員' })).getByText('9 芋')).toBeTruthy();
    expect(within(screen.getByRole('article', { name: '作業員' })).getByText(/1台あたり \+1.5/)).toBeTruthy();
    tickAfter(10);
    expect(screen.getByLabelText('所持芋').textContent).toBe('15');
    fireEvent.click(screen.getByRole('button', { name: '作業員を1台購入' }));
    expect(screen.getByLabelText('所持芋').textContent).toBe('6');
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('15');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('3');
  });

  it('shows prerequisite, insufficient-point and max-rank reasons', () => {
    const first = prestigeGame(advanceGame(createInitialState(), 1_000_000));
    seedGame(first);
    const view = renderGame();
    expect(within(screen.getByRole('article', { name: '設備の目利き' })).getByText('前提スキルが未取得です。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '豊かな収穫を強化' }));
    expect(within(screen.getByRole('article', { name: '豊かな収穫' })).getByText('転生ポイントが足りません。')).toBeTruthy();
    view.unmount();
    let maximum = createInitialState();
    for (let index = 0; index < 3; index += 1) maximum = prestigeGame(advanceGame(maximum, 1_000_000));
    for (let index = 0; index < 3; index += 1) maximum = purchaseSkill(maximum, 'harvest');
    seedGame(maximum);
    renderGame();
    expect(within(screen.getByRole('article', { name: '豊かな収穫' })).getByText('最大ランクに到達しています。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '豊かな収穫を強化' }) as HTMLButtonElement).disabled).toBe(true);
    const cappedSkill = screen.getByRole('article', { name: '豊かな収穫' });
    expect(cappedSkill.textContent).not.toMatch(/4pt|次の効果|×3|\/ 7/);
  });

  it('retains permanent growth through reload and manual export/import', () => {
    seedGame(advanceGame(createInitialState(), 1_000_000));
    const view = renderGame();
    confirmPrestige(2);
    fireEvent.click(screen.getByRole('button', { name: '豊かな収穫を強化' }));
    view.unmount();
    renderGame();
    expect(screen.getByLabelText('累計転生回数').textContent).toBe('1');
    expect(screen.getByLabelText('未使用ポイント').textContent).toBe('1');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('1.5');
    openSavePanel();
    fireEvent.click(screen.getByRole('button', { name: 'セーブをエクスポート' }));
    const exported = (screen.getByLabelText('エクスポート用セーブ（全選択してコピー）') as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByRole('button', { name: '設備の目利きを強化' }));
    fireEvent.change(screen.getByLabelText('インポートするセーブテキスト'), { target: { value: exported } });
    fireEvent.click(screen.getByRole('button', { name: 'インポート内容を確認' }));
    fireEvent.click(screen.getByRole('button', { name: 'このセーブに置き換える' }));
    expect(screen.getByLabelText('未使用ポイント').textContent).toBe('1');
    expect(screen.getByLabelText('設備の目利きのランク').textContent).toBe('0');
    expect(screen.getByLabelText('豊かな収穫のランク').textContent).toBe('1');
  });

  it('requests a new confirmation when the final click crosses the 2pt boundary', () => {
    seedGame({ ...createInitialState(), imo: gn(999_999), runEarnedScore: gn(999_999) });
    renderGame();
    fireEvent.click(screen.getByRole('button', { name: '転生する' }));
    now += 2_000;
    fireEvent.click(screen.getByRole('button', { name: '転生を実行（1pt）' }));
    expect(screen.getByRole('alert').textContent).toContain('最新の報酬');
    expect(screen.getByLabelText('累計転生回数').textContent).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: '転生を実行（2pt）' }));
    expect(screen.getByLabelText('未使用ポイント').textContent).toBe('2');
    expect(screen.getByLabelText('累計転生回数').textContent).toBe('1');
  });
});
