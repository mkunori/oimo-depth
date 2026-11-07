import { useEffect, useRef, useState } from 'react';
import { formatNumber } from '../../components/formatNumber';
import { getDeepResearch, getResearchPurchase } from '../../core/research';
import type { GameState } from '../../core/state';
import { getResearchSpent, RESEARCH, RESEARCH_IDS } from '../../data/research';
import type { ResearchId } from '../../data/research';

interface Props {
  readonly state: GameState;
  readonly isPaused: boolean;
  readonly onBreakthrough: () => boolean;
  readonly onPurchase: (id: ResearchId) => boolean;
  readonly onReset: () => boolean;
}

export function ResearchPanel({ state, isPaused, onBreakthrough, onPurchase, onReset }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!confirming || !dialog.current) return;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); trigger.current?.focus(); };
  }, [confirming]);
  const quote = getDeepResearch(state);
  const introduced = state.permanent.deepResearchUnlocked || state.scoreCapStage === 2
    || (state.scoreCapStage === 1 && state.runEarnedScore.gte(1e9));
  return <section className="panel research-panel" aria-labelledby="research-title">
    <div className="section-heading"><span className="section-index" aria-hidden="true">04</span><h2 id="research-title">地層研究</h2></div>
    <h3>深層解析 {state.permanent.deepResearchUnlocked ? '— 研究権限を取得済み' : '— 未解禁'}</h3>
    <p>{introduced ? '深層の地脈を解析し、同じ周回のSCORE上限を1E9から1E12へ拡張します。費用は無料です。' : '初回限界突破のあと、SCORE 1E9到達で深層解析を解禁します。'}</p>
    <button className="secondary-button" type="button" ref={trigger} disabled={isPaused || !quote.canResearch} aria-describedby="research-reason" onClick={() => { setError(false); setConfirming(true); }}>研究による突破</button>
    <p id="research-reason">{isPaused ? 'セーブ確認のため研究を停止しています。' : quote.reason ?? 'SCORE 1E9到達。リセットなし・無料で次の段階へ進めます。'}</p>
    <p>通常転生では上限1E6へ戻り、設備と研究強化はリセットします。研究権限・転生スキル・自動購入設定は保持し、再到達時も無料で再突破できます。</p>
    <div className="research-nodes">
      {RESEARCH_IDS.map((id) => {
        const definition = RESEARCH[id];
        const purchase = getResearchPurchase(state, id);
        return <article className="research-node" key={id} aria-labelledby={`research-${id}`}>
          <h3 id={`research-${id}`}>{definition.name} <span>ランク {purchase.rank} / {definition.costs.length}</span></h3>
          <p>{definition.description}</p>
          <button type="button" className="secondary-button" disabled={isPaused || !purchase.canPurchase} aria-describedby={`research-${id}-reason`} onClick={() => onPurchase(id)}>{definition.name}を強化{purchase.cost !== null ? `（${formatNumber(purchase.cost)} 芋）` : ''}</button>
          <p id={`research-${id}-reason`}>{purchase.reason ?? '所持芋のみ消費します。累計SCOREは減りません。'}</p>
        </article>;
      })}
    </div>
    <button type="button" className="secondary-button" disabled={isPaused || state.scoreCapStage !== 2 || state.runEarnedScore.gte(1e12) || getResearchSpent(state.researchRanks).equals(0)} onClick={onReset}>研究強化を振り直す（{formatNumber(getResearchSpent(state.researchRanks))} 芋を全額返却）</button>
    <p>強化は段階2のみ。上限到達前なら無料で振り直せます。1E12で収穫・購入は停止します。さらに先の突破・上位転生は未実装です。</p>
    {confirming && <dialog ref={dialog} className="prestige-dialog" aria-labelledby="research-dialog-title" onCancel={() => setConfirming(false)}>
      <h2 id="research-dialog-title">研究による突破：リセットなし / SCORE 1E9→1E12</h2>
      <p>深層解析を無料で実行します。SCORE・所持芋・設備・恒久スキル・自動購入設定を保持し、同じ周回で生産を再開します。研究・突破・研究強化は自動購入されません。</p>
      {error && <p role="alert">研究できませんでした。最新の条件とセーブ状態を確認してください。</p>}
      <div className="confirmation-actions">
        <button type="button" className="secondary-button" autoFocus onClick={() => setConfirming(false)}>キャンセル</button>
        <button type="button" className="secondary-button" disabled={isPaused || !quote.canResearch} onClick={() => { if (onBreakthrough()) setConfirming(false); else setError(true); }}>無料で研究突破を実行</button>
      </div>
    </dialog>}
  </section>;
}
