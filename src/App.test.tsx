// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

let now = 0;

beforeEach(() => {
  now = 0;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
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
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getAllByText('所持芋が足りません。')).toHaveLength(3);
    expect(screen.getByText(/ページを再読み込みすると最初から/)).toBeTruthy();
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
    expect(screen.getByLabelText('所持芋').textContent).toBe('0');
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
    for (const button of screen.getAllByRole('button')) {
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
