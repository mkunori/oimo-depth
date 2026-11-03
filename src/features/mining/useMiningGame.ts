import { useCallback, useEffect, useRef, useState } from 'react';
import { advanceGame, purchaseEquipment } from '../../core/game';
import type { PurchaseMode } from '../../core/game';
import { createInitialState } from '../../core/state';
import { INITIAL_BALANCE } from '../../data/balance';
import type { EquipmentId } from '../../data/equipment';

const UPDATE_INTERVAL_MS = 250;

export function useMiningGame() {
  const [state, setState] = useState(createInitialState);
  const lastUpdatedAt = useRef<number | null>(null);

  const consumeElapsedSeconds = useCallback(() => {
    const now = performance.now();
    const elapsed = lastUpdatedAt.current === null ? 0 : (now - lastUpdatedAt.current) / 1_000;
    lastUpdatedAt.current = now;
    return Math.max(0, elapsed);
  }, []);

  useEffect(() => {
    lastUpdatedAt.current = performance.now();
    const timer = window.setInterval(() => {
      // 時刻の取得は updater の外で一度だけ。StrictMode の再実行でも同じ入力にする。
      const elapsed = consumeElapsedSeconds();
      setState((current) => advanceGame(current, elapsed));
    }, UPDATE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [consumeElapsedSeconds]);

  const purchase = useCallback((id: EquipmentId, mode: PurchaseMode) => {
    // 最後の描画から購入時刻までは購入前の生産能力で精算する。
    const elapsed = consumeElapsedSeconds();
    setState((current) => {
      const advanced = advanceGame(current, elapsed);
      return advanced.runEarnedScore >= INITIAL_BALANCE.scoreCap
        ? advanced
        : purchaseEquipment(advanced, id, mode);
    });
  }, [consumeElapsedSeconds]);

  return { state, purchase };
}
