import { getProductionPerSecond } from './core/game';
import { INITIAL_BALANCE } from './data/balance';
import { MiningPanel } from './features/mining/MiningPanel';
import { useMiningGame } from './features/mining/useMiningGame';
import { Shop } from './features/shop/Shop';

export default function App() {
  const { state, purchase } = useMiningGame();
  const isCapped = state.runEarnedScore >= INITIAL_BALANCE.scoreCap;

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">芋を掘り、深く進む。</p>
          <h1>IMO DEPTH</h1>
        </div>
        <p className="edition">小さな芋から、大きな収穫へ。<span>採掘の旅、はじまりの一周。</span></p>
      </header>
      <div className="game-layout">
        <MiningPanel state={state} production={getProductionPerSecond(state)} isCapped={isCapped} />
        <Shop state={state} isCapped={isCapped} onPurchase={purchase} />
      </div>
      <footer className="app-footer">
        <p>保存機能は未実装です。ページを再読み込みすると最初からになります。</p>
        <span aria-hidden="true">IMO DEPTH / v0</span>
      </footer>
    </main>
  );
}
