// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createSave, parseSave, serializeSave } from './core/save';
import { createInitialState } from './core/state';
import { SAVE_STORAGE_KEY } from './features/save/SaveRepository';

let now = 0;

beforeEach(() => {
  now = 0;
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000 + Math.floor(now));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
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
    expect(screen.getAllByRole('article')).toHaveLength(3);
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
    ['MAX', 1_000, '19', '108', '20'],
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
    expect(screen.getByLabelText('所持芋').textContent)
      .toBe(new Intl.NumberFormat('ja-JP').format(Number(balance) + Number(rate)));
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
    expect(screen.getByText('転生は後続Issueで実装予定です。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /転生/ })).toBeNull();
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
