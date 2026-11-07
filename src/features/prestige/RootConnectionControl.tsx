import { useEffect, useRef, useState } from 'react';
import { getRootConnection } from '../../core/rootConnection';
import type { GameState } from '../../core/state';

interface Props { readonly state: GameState; readonly isPaused: boolean; readonly onConnect: () => boolean }
export function RootConnectionControl({ state, isPaused, onConnect }: Props) {
  const quote = getRootConnection(state);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!confirming || !dialog.current) return;
    const element = dialog.current; element.showModal();
    return () => { element.close(); trigger.current?.focus(); };
  }, [confirming]);
  if (state.scoreCapStage < 2 && state.permanent.maxDiscoveredStage < 3) return null;
  return <div className="breakthrough-control root-connection-control">
    <h3>第3限界突破</h3>
    <p>根脈接続解析で、SCORE 1E12から上限1E15へ無料で進みます。スキルのリセットはありません。</p>
    {state.permanent.maxDiscoveredStage < 3 && <p>次の発見: ？？？</p>}
    <button type="button" className="secondary-button" ref={trigger} disabled={isPaused || !quote.canConnect} aria-describedby="root-connection-reason" onClick={() => { setError(false); setConfirming(true); }}>根脈接続解析</button>
    <p id="root-connection-reason">{isPaused ? 'セーブ確認のため接続解析を停止しています。' : quote.reason ?? 'リセットせず同じ周回を継続できます。通常転生も2ptで選べます。'}</p>
    {confirming && <dialog ref={dialog} className="prestige-dialog" aria-labelledby="root-connection-title" onCancel={() => setConfirming(false)}>
      <h2 id="root-connection-title">根脈接続解析：リセットなし / SCORE 1E12→1E15</h2>
      <p>SCORE・所持芋・設備・全スキル・研究ランク・ポイント・自動購入設定を保持し、無料で上限だけを拡張します。深層記憶の解析回数や当周回のスキル再購入制限は変わりません。</p>
      <p>通常転生では上限1E6へ戻り、設備と研究はリセットします。発見履歴と接続権は残り、再到達時に無料で再突破できます。SCORE 1E15到達後は次の無料解析を選べます。</p>
      {error && <p role="alert">接続解析できませんでした。最新のSCOREとセーブ状態を確認してください。</p>}
      <div className="confirmation-actions">
        <button type="button" className="secondary-button" autoFocus onClick={() => setConfirming(false)}>キャンセル</button>
        <button type="button" className="secondary-button" disabled={isPaused || !quote.canConnect} onClick={() => { if (onConnect()) setConfirming(false); else setError(true); }}>無料で根脈接続を実行</button>
      </div>
    </dialog>}
  </div>;
}
