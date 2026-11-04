import { getProductionPerSecond } from './core/game';
import { INITIAL_BALANCE } from './data/balance';
import { MiningPanel } from './features/mining/MiningPanel';
import { useMiningGame } from './features/mining/useMiningGame';
import { Shop } from './features/shop/Shop';
import { SavePanel } from './features/save/SavePanel';

export default function App() {
  const { state, snapshot, purchase, exportText, importSave, reset, dismissReport } = useMiningGame();
  const isCapped = state.runEarnedScore >= INITIAL_BALANCE.scoreCap;
  const isPaused = snapshot.status !== 'ready';

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
        <MiningPanel state={state} production={getProductionPerSecond(state)} isCapped={isCapped} isPaused={isPaused} />
        <Shop state={state} isCapped={isCapped} isPaused={isPaused} onPurchase={purchase} />
      </div>
      <SavePanel snapshot={snapshot} onExport={exportText} onImport={importSave} onReset={reset} onDismissReport={dismissReport} />
      <footer className="app-footer">
        <p>このブラウザに自動保存します。大切な進行はセーブ管理からエクスポートして保管してください。</p>
        <span aria-hidden="true">IMO DEPTH / v0</span>
      </footer>
    </main>
  );
}
