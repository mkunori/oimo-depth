// @vitest-environment jsdom
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

let now = 0;

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

describe('minimal mining game', () => {
  it('shows the initial balance, rate, score, labelled gauge, and equipment', () => {
    renderGame();

    expect(screen.getByRole('heading', { name: 'IMO DEPTH' })).toBeTruthy();
    expect(screen.getByLabelText('所持芋').textContent).toBe('0');
    expect(screen.getByLabelText('現在SCORE').textContent).toBe('0');
    expect(screen.getByLabelText('収穫速度').textContent).toBe('1');
    const progress = screen.getByRole('progressbar', { name: 'SCORE' }) as HTMLProgressElement;
    expect(progress.value).toBe(0);
    expect(progress.max).toBe(1_000_000);
    expect(within(screen.getByRole('region', { name: '設備' })).getAllByRole('article')).toHaveLength(5);
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
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(1_000_000);
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
    seedGame({ ...createInitialState(), imo: 100, runEarnedScore: 1_000,
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
      seedGame({ ...createInitialState(), imo: 200_000, runEarnedScore: 200_000,
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

describe('prestige and skill UI', () => {
  it.each([[99_999, '0', true], [100_000, '1', false], [999_999, '1', false], [1_000_000, '2', false]] as const)(
    'previews the reward at SCORE %s', (score, reward, disabled) => {
      seedGame({ ...createInitialState(), imo: score, runEarnedScore: score });
      renderGame();
      expect(screen.getByLabelText('獲得見込みポイント').textContent).toBe(reward);
      expect((screen.getByRole('button', { name: '転生する' }) as HTMLButtonElement).disabled).toBe(disabled);
    },
  );

  it('cancels without resetting, then confirms exactly one reset and reward under StrictMode', () => {
    seedGame({ ...createInitialState(), imo: 90_000, runEarnedScore: 100_000, equipmentCounts: { ...createInitialState().equipmentCounts, worker: 3, cart: 1, harvester: 0 } });
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
    seedGame({ ...createInitialState(), imo: 999_999, runEarnedScore: 999_999 });
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
