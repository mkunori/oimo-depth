import { useEffect, useRef, useState } from 'react';
import { getOriginAnalysis } from '../../core/origin';
import type { GameState } from '../../core/state';

export function OriginAnalysisControl({ state, isPaused, onAnalyze }: {
  readonly state: GameState; readonly isPaused: boolean; readonly onAnalyze: () => boolean;
}) {
  const [confirming, setConfirming] = useState(false), [error, setError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!confirming || !dialog.current) return;
    const element = dialog.current; element.showModal();
    return () => { element.close(); trigger.current?.focus(); };
  }, [confirming]);
  if (state.scoreCapStage < 3 && state.permanent.maxDiscoveredStage < 4) return null;
  const quote = getOriginAnalysis(state);
  return <div className="breakthrough-control">
    <h3>第4限界突破</h3>
    <p>地底核心の解析で、SCORE 1E15から上限1E18へ無料で進みます。研究・DEPTHの条件はありません。</p>
    {state.permanent.maxDiscoveredStage < 4 && <p>次の発見: ？？？</p>}
    <button type="button" className="secondary-button" ref={trigger} disabled={isPaused || !quote.canAnalyze} aria-describedby="origin-reason" onClick={() => { setError(false); setConfirming(true); }}>地底核心の解析</button>
    <p id="origin-reason">{isPaused ? 'セーブ確認のため解析を停止しています。' : quote.reason ?? '全資産を保持し、同じ周回で生産と掘削を再開できます。通常転生も2ptで選べます。'}</p>
    {confirming && <dialog ref={dialog} className="prestige-dialog" aria-labelledby="origin-title" onCancel={() => setConfirming(false)}>
      <h2 id="origin-title">地底核心の解析：リセットなし / SCORE 1E15→1E18</h2>
      <p>SCORE・所持芋・設備・全研究・DEPTH・スキル・ポイント・自動購入設定を保持し、無料で上限だけを拡張します。</p>
      <p>通常転生では深層解析済みの上限1E12（段階2）へ戻り、設備と周回研究をリセットします。発見履歴と解析権は残り、SCORE 1E12・1E15へ再到達して手動で再突破できます。</p>
      {error && <p role="alert">解析できませんでした。最新のSCOREとセーブ状態を確認してください。</p>}
      <div className="confirmation-actions">
        <button type="button" className="secondary-button" autoFocus onClick={() => setConfirming(false)}>キャンセル</button>
        <button type="button" className="secondary-button" disabled={isPaused || !quote.canAnalyze} onClick={() => { if (onAnalyze()) setConfirming(false); else setError(true); }}>無料で地底核心を解析</button>
      </div>
    </dialog>}
  </div>;
}
