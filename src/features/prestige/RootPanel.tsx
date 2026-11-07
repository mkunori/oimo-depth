import { useEffect, useRef, useState } from 'react';
import { getRootRebirth, getRootUpgradePurchase } from '../../core/root';
import { getRootBonuses } from '../../core/rootProgress';
import { ROOT_FIRST_PRODUCTION_MULTIPLIER, ROOT_UPGRADES, ROOT_UPGRADE_IDS } from '../../data/root';
import type { RootUpgradeId } from '../../data/root';
import type { GameState } from '../../core/state';
import { formatNumber } from '../../components/formatNumber';

export function RootPanel({ state, isPaused, notice, onRebirth, onPurchase }: {
  readonly state: GameState; readonly isPaused: boolean; readonly notice: string | null;
  readonly onRebirth: () => boolean; readonly onPurchase: (id: RootUpgradeId) => boolean;
}) {
  const [confirming, setConfirming] = useState(false), [error, setError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!confirming || !dialog.current) return;
    const element = dialog.current; element.showModal();
    return () => { element.close(); if (trigger.current && !trigger.current.disabled) trigger.current.focus(); else title.current?.focus(); };
  }, [confirming]);
  if (state.permanent.maxDiscoveredStage < 4) return null;
  const quote = getRootRebirth(state), permanent = state.permanent, root = getRootBonuses(permanent);
  return <section className="panel root-panel" aria-labelledby="root-title">
    <div className="section-heading"><span className="section-index" aria-hidden="true">05</span><h2 id="root-title" ref={title} tabIndex={-1}>ROOT REBIRTH</h2></div>
    <p>現周回のSCORE 1E18で選べる根源転生です。自動では実行しません。通常転生（2pt）も選べます。</p>
    <dl className="root-stats">
      <div><dt>ROOT結晶</dt><dd><output aria-label="ROOT結晶">{formatNumber(permanent.unspentRootCrystals)}</output> 個</dd></div>
      <div><dt>ROOT回数</dt><dd><output aria-label="ROOT回数">{formatNumber(permanent.rootRebirthCount)}</output> 回</dd></div>
      <div><dt>累計獲得 / 使用</dt><dd>{formatNumber(permanent.totalRootCrystalsEarned)} / {formatNumber(permanent.totalRootCrystalsSpent)} 個</dd></div>
    </dl>
    <p>次回報酬: ROOT結晶 {quote.nextCrystals}個。初回ROOTで恒久の全収穫 ×{ROOT_FIRST_PRODUCTION_MULTIPLIER}を獲得します。繰り返しROOTでこの固定倍率は重複しません。</p>
    <button type="button" className="secondary-button" ref={trigger} disabled={isPaused || !quote.canRebirth} aria-describedby="root-rebirth-reason" onClick={() => { setError(false); setConfirming(true); }}>ROOT REBIRTHする</button>
    <p id="root-rebirth-reason">{isPaused ? 'セーブ確認のためROOTを停止しています。' : quote.reason ?? 'ROOT結晶1個を獲得できます。リセット・保持範囲を確認して選んでください。'}</p>
    <details className="root-reset-scope"><summary>リセット・引継ぎ範囲</summary><RootResetScope equipmentKnown={permanent.equipmentSystemUnlocked} /></details>
    {permanent.equipmentSystemUnlocked && <>
      <aside className="root-equipment-gate" aria-label="装備システム解禁">
        {permanent.rootRebirthCount === 1 && notice?.startsWith('初回ROOT') && <svg className="root-discovery" viewBox="0 0 80 56" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M40 4l15 16-15 16-15-16zM40 36v16M40 40l-15 9M40 44l15 9M25 20H9M55 20h16M22 9l-8-5M58 9l8-5" /></svg>}
        <h3>装備システム解禁</h3><p>解禁権を恒久保持しています。装備の購入・モード・プリセットはIssue #33で実装予定です。</p>
      </aside>
      <h3>ROOT恒久強化</h3>
      <p>ROOT結晶は芋・SCORE・通常ポイントとは別です。初回1個は全体生産か設備割引・次回初期支給に使えます。購入の振り直しはありません。温存も選べます。</p>
      <p>ROOT由来の全収穫 ×{root.production} / 後期設備・掘削 ×{root.lateAndDig} / 次回の追加初期芋 {formatNumber(root.startingImo)}。</p>
      <div className="research-nodes">
        {ROOT_UPGRADE_IDS.map((id) => {
          const definition = ROOT_UPGRADES[id], purchase = getRootUpgradePurchase(state, id);
          return <article className="research-node" key={id} aria-labelledby={`root-upgrade-${id}`}>
            <h3 id={`root-upgrade-${id}`}>{definition.name} <span>ランク {purchase.rank} / {definition.costs.length}</span></h3>
            <p>{definition.description}</p>
            {definition.prerequisites.length > 0 && <p>前提: {definition.prerequisites.map((required) => `${ROOT_UPGRADES[required.id].name} ランク${required.rank}`).join('、')}</p>}
            <button type="button" className="secondary-button" disabled={isPaused || !purchase.canPurchase} aria-describedby={`root-upgrade-${id}-reason`} onClick={() => onPurchase(id)}>{definition.name}を強化{purchase.cost !== null ? `（ROOT結晶 ${purchase.cost}個）` : ''}</button>
            <p id={`root-upgrade-${id}-reason`}>{isPaused ? 'セーブ確認のため購入を停止しています。' : purchase.reason ?? 'ROOT結晶のみ消費します。恒久強化は通常転生・ROOT後も保持します。'}</p>
          </article>;
        })}
      </div>
    </>}
    {confirming && <dialog ref={dialog} className="prestige-dialog" aria-labelledby="root-rebirth-dialog-title" onCancel={() => setConfirming(false)}>
      <h2 id="root-rebirth-dialog-title">ROOT REBIRTH：ROOT結晶 {quote.crystals}個を獲得</h2>
      <RootResetScope equipmentKnown={permanent.equipmentSystemUnlocked} />
      <p>通常転生は同時に実行しません。通常転生回数・通常ポイントは増えません。次回の初期所持芋は維持したスキルとROOT強化から計算し、SCOREへ加算しません。</p>
      {permanent.rootRebirthCount === 0 && <p>初回ROOTの固定ボーナスは全収穫×{ROOT_FIRST_PRODUCTION_MULTIPLIER}です。新しい恒久機能は実行後に公開します。</p>}
      {error && <p role="alert">ROOTできませんでした。最新のSCOREとセーブ状態を確認してください。</p>}
      <div className="confirmation-actions">
        <button type="button" className="secondary-button" autoFocus onClick={() => setConfirming(false)}>キャンセル</button>
        <button type="button" className="secondary-button" disabled={isPaused || !quote.canRebirth} onClick={() => { if (onRebirth()) setConfirming(false); else setError(true); }}>ROOTを実行（結晶{quote.crystals}個）</button>
      </div>
    </dialog>}
  </section>;
}

function RootResetScope({ equipmentKnown }: { readonly equipmentKnown: boolean }) {
  return <>
    <p><strong>リセット:</strong> 現周回SCORE・所持芋・設備・SCORE上限段階（0へ）・周回研究4種・生産端数・当周回の強化スキル再購入制限。</p>
    <p><strong>保持:</strong> 通常転生回数・通常ポイント・取得スキル・全突破/解析権・自動購入の解禁と全設定・DEPTHと端数・地層発見・恒久掘削研究・ROOT回数/結晶/恒久進行{equipmentKnown ? '・装備システム解禁権' : ''}。</p>
  </>;
}
