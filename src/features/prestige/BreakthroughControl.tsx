import { useEffect, useRef, useState } from 'react';
import { getBreakthrough } from '../../core/breakthrough';
import type { GameState } from '../../core/state';

interface Props {
  readonly state: GameState;
  readonly isPaused: boolean;
  readonly onBreakthrough: () => boolean;
}

export function BreakthroughControl({ state, isPaused, onBreakthrough }: Props) {
  const quote = getBreakthrough(state);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!confirming || !dialog.current) return;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); trigger.current?.focus(); };
  }, [confirming]);
  return <div className="breakthrough-control">
    <h3>限界突破</h3>
    <p>「限界突破の心得」を取得し、SCORE 1,000,000で上限を1E9へ拡張します。現在の周回をそのまま続けられます。</p>
    <button type="button" className="secondary-button" ref={trigger} disabled={isPaused || !quote.canBreakthrough} aria-describedby="breakthrough-reason" onClick={() => { setError(null); setConfirming(true); }}>限界突破する</button>
    <p id="breakthrough-reason">{isPaused ? 'セーブの確認が必要なため限界突破を停止しています。' : quote.reason ?? '転生せず、所持芋・SCORE・設備・スキル・転生回数を引き継いで採掘を再開できます。'}</p>
    {confirming && <dialog ref={dialog} className="prestige-dialog" aria-labelledby="breakthrough-dialog-title" aria-describedby="breakthrough-dialog-description" onCancel={() => setConfirming(false)}>
      <h2 id="breakthrough-dialog-title">転生せずに限界突破しますか？</h2>
      <p id="breakthrough-dialog-description">取得済みの「限界突破の心得」を使い、現在のSCORE上限を1,000,000から1E9へ変更します。SCOREは加算されません。</p>
      <p>リセットはありません。所持芋・SCORE・設備・スキル・転生回数・未使用ポイントをすべて保持し、追加ポイントは消費しません。</p>
      <p>{state.permanent.deepAnalysisActiveThisRoot ? '通常転生では解析済みの上限1E12を引き継ぎます。' : '通常転生を選ぶと周回上限は1,000,000に戻ります。'}突破権は維持され、再到達時に無料で再突破できます。</p>
      {error && <p role="alert">{error}</p>}
      <div className="confirmation-actions">
        <button type="button" className="secondary-button" autoFocus onClick={() => setConfirming(false)}>キャンセル</button>
        <button type="button" className="secondary-button" disabled={isPaused || !quote.canBreakthrough} onClick={() => {
          if (onBreakthrough()) setConfirming(false);
          else setError('限界突破できませんでした。最新のSCOREとセーブ状態を確認してください。');
        }}>限界突破を実行</button>
      </div>
    </dialog>}
  </div>;
}
