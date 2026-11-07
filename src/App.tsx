import { getProductionPerSecond } from './core/game';
import { getScoreCap } from './data/scoreCaps';
import { MiningPanel } from './features/mining/MiningPanel';
import { useMiningGame } from './features/mining/useMiningGame';
import { Shop } from './features/shop/Shop';
import { SavePanel } from './features/save/SavePanel';
import { PrestigePanel } from './features/prestige/PrestigePanel';
import { ResearchPanel } from './features/research/ResearchPanel';

export default function App() {
  const { state, snapshot, purchase, exportText, importSave, reset, dismissReport, prestige, buySkill, breakthrough, setAutomation, deepResearch, buyResearch, resetResearch } = useMiningGame();
  const isCapped = state.runEarnedScore.gte(getScoreCap(state));
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
        <MiningPanel state={state} production={getProductionPerSecond(state)} isCapped={isCapped} isPaused={isPaused} onBreakthrough={breakthrough} />
        <Shop state={state} isCapped={isCapped} isPaused={isPaused} onPurchase={purchase} milestoneNotice={snapshot.milestoneNotice} automaticPurchases={snapshot.automaticPurchases} onAutomationChange={setAutomation} />
      </div>
      <PrestigePanel state={state} isPaused={isPaused} notice={snapshot.progressNotice} onPrestige={prestige} onBuySkill={buySkill} />
      <ResearchPanel state={state} isPaused={isPaused} onBreakthrough={deepResearch} onPurchase={buyResearch} onReset={resetResearch} />
      <SavePanel snapshot={snapshot} onExport={exportText} onImport={importSave} onReset={reset} onDismissReport={dismissReport} />
      <footer className="app-footer">
        <p>このブラウザに自動保存します。大切な進行はセーブ管理からエクスポートして保管してください。</p>
        <span aria-hidden="true">IMO DEPTH / v0</span>
      </footer>
    </main>
  );
}
