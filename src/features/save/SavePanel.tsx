import { useEffect, useRef, useState } from 'react';
import { formatNumber } from '../../components/formatNumber';
import { parseSave } from '../../core/save';
import type { SaveData } from '../../core/save';
import type { SessionSnapshot } from './GameSession';

interface SavePanelProps {
  readonly snapshot: SessionSnapshot;
  readonly onExport: () => string;
  readonly onImport: (save: SaveData) => boolean;
  readonly onReset: () => boolean;
  readonly onDismissReport: () => void;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${formatNumber(seconds)}秒`;
  return `${Math.floor(seconds / 3_600)}時間 ${Math.floor(seconds % 3_600 / 60)}分`;
}

export function SavePanel({ snapshot, onExport, onImport, onReset, onDismissReport }: SavePanelProps) {
  const [input, setInput] = useState('');
  const [exported, setExported] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ type: 'import'; save: SaveData } | { type: 'reset' } | null>(null);
  const confirmation = useRef<HTMLButtonElement>(null);
  const replacementBlocked = snapshot.status === 'conflict' || snapshot.status === 'unavailable' || snapshot.status === 'loading';

  useEffect(() => { if (pending) confirmation.current?.focus(); }, [pending]);

  const previewImport = () => {
    setError(null);
    setNotice(null);
    setPending(null);
    try { setPending({ type: 'import', save: parseSave(input) }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'セーブを読み込めません。'); }
  };

  const confirm = () => {
    if (!pending) return;
    const succeeded = pending.type === 'import' ? onImport(pending.save) : onReset();
    if (succeeded) {
      setNotice(pending.type === 'import' ? 'セーブを復元して保存しました。' : 'セーブを初期化しました。');
      setInput('');
      setExported('');
      setPending(null);
    }
  };

  return (
    <section className="save-area" aria-label="セーブと放置報酬">
      {snapshot.message && <p className="save-warning" role="alert">{snapshot.message}</p>}
      {snapshot.report && (snapshot.report.elapsedSeconds > 0 || snapshot.report.clockReversed) && (
        <section className="offline-report" aria-labelledby="offline-title">
          <div className="report-heading"><h2 id="offline-title">おかえりなさい</h2><button type="button" className="text-button" onClick={onDismissReport} aria-label="放置報酬の報告を閉じる">閉じる</button></div>
          <dl className="offline-stats">
            <div><dt>経過時間</dt><dd>{duration(snapshot.report.elapsedSeconds)}</dd></div>
            <div><dt>反映した時間</dt><dd>{duration(snapshot.report.appliedSeconds)}</dd></div>
            <div><dt>獲得芋</dt><dd>{formatNumber(snapshot.report.earnedImo)} 芋</dd></div>
            <div><dt>到達SCORE</dt><dd>{formatNumber(snapshot.report.reachedScore)}</dd></div>
            <div><dt>掘り進んだ深度</dt><dd>{formatNumber(snapshot.report.earnedDepth)} m</dd></div>
          </dl>
          <p>放置報酬は最大24時間分です。SCORE 上限を超える収穫は加算されません。</p>
          {snapshot.report.automaticPurchases > 0 && <p>放置中の自動購入: {snapshot.report.automaticPurchases} 台。獲得芋は設備支出前の収穫量です。</p>}
          {snapshot.report.clockReversed && <p role="alert">端末の時計が保存時刻より前のため、放置報酬は加算していません。端末の日時を確認してください。</p>}
        </section>
      )}
      <details className="save-panel">
        <summary>セーブ管理 <span>{snapshot.status === 'ready' ? '自動保存中' : '保存停止中'}</span></summary>
        <div className="save-content">
          <p>10秒ごと・設備購入時・ページを離れるときに、このブラウザへ保存します。</p>
          {snapshot.savedAt !== null && <p className="save-timestamp">最終保存: {new Date(snapshot.savedAt).toLocaleString('ja-JP')}</p>}
          <p>複数のタブで同時に遊ばないでください。別タブの変更を検出した場合は進行と保存を停止します。</p>
          <div className="save-field">
            <button type="button" className="secondary-button" onClick={() => { setExported(onExport()); setNotice('下のテキストをコピーして保管してください。'); }}>セーブをエクスポート</button>
            {exported && <><label htmlFor="save-export">エクスポート用セーブ（全選択してコピー）</label><textarea id="save-export" value={exported} readOnly rows={4} onFocus={(event) => event.currentTarget.select()} /></>}
          </div>
          <div className="save-field">
            <label htmlFor="save-import">インポートするセーブテキスト</label>
            <textarea id="save-import" value={input} onChange={(event) => { setInput(event.target.value); setPending(null); setError(null); }} rows={4} spellCheck={false} aria-describedby="import-help" />
            <p id="import-help">内容を確認してから現在の進行を置き換えます。インポート時には追加の放置報酬は加算しません。</p>
            <button type="button" className="secondary-button" disabled={replacementBlocked} onClick={previewImport}>インポート内容を確認</button>
          </div>
          {error && <p className="save-warning" role="alert">{error} 現在の進行とセーブは保持しています。</p>}
          <button type="button" className="text-button reset-button" disabled={replacementBlocked} onClick={() => { setPending({ type: 'reset' }); setNotice(null); setError(null); }}>セーブを初期化</button>
          {pending && (
            <div className="save-confirmation" role="group" aria-label={pending.type === 'import' ? 'インポートの確認' : '初期化の確認'}>
              <h3>{pending.type === 'import' ? 'このセーブに置き換えますか？' : '最初からやり直しますか？'}</h3>
              {pending.type === 'import' && <><p>所持芋 {formatNumber(pending.save.gameState.imo)} / SCORE {formatNumber(pending.save.gameState.runEarnedScore)}</p><p>DEPTH {formatNumber(pending.save.gameState.permanent.depthMeters)} m</p><p>累計転生 {formatNumber(pending.save.gameState.permanent.prestigeCount)}回 / 未使用 {formatNumber(pending.save.gameState.permanent.unspentPoints)}pt</p></>}
              {pending.type === 'import' && pending.save.gameState.permanent.equipmentSystemUnlocked && <p>ROOT {formatNumber(pending.save.gameState.permanent.rootRebirthCount)}回 / ROOT結晶 {formatNumber(pending.save.gameState.permanent.unspentRootCrystals)}個 / 装備システム解禁済み</p>}
              {pending.type === 'reset' && <p>DEPTH・掘削研究・通常/ROOT転生回数・通常ポイント/ROOT結晶・恒久強化・解禁権を含むすべての進行を削除します。</p>}
              <p>現在の進行は上書きされ、元に戻せません。必要な場合は先にエクスポートしてください。</p>
              <div className="confirmation-actions">
                <button type="button" className="secondary-button" disabled={replacementBlocked} ref={confirmation} onClick={confirm}>{pending.type === 'import' ? 'このセーブに置き換える' : '初期化を実行'}</button>
                <button type="button" className="text-button" onClick={() => setPending(null)}>キャンセル</button>
              </div>
            </div>
          )}
          {notice && <p role="status">{notice}</p>}
        </div>
      </details>
    </section>
  );
}
