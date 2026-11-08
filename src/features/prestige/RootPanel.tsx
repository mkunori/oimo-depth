import { useEffect, useRef, useState } from 'react';
import { getRootRebirth, getRootUpgradePurchase } from '../../core/root';
import { getRootBonuses, getRootCountMultiplier } from '../../core/rootProgress';
import { ROOT_UPGRADES, ROOT_UPGRADE_IDS } from '../../data/root';
import { getSkillPointsSpent } from '../../core/prestigePoints';
import { gn } from '../../core/numbers';
import type { PermanentProgress } from '../../core/state';
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
    const element = dialog.current; element.showModal(); element.querySelector('h2')?.focus();
    return () => { element.close(); if (trigger.current && !trigger.current.disabled) trigger.current.focus(); else title.current?.focus(); };
  }, [confirming]);
  if (state.permanent.maxDiscoveredStage < 4) return null;
  const quote = getRootRebirth(state), permanent = state.permanent, root = getRootBonuses(permanent);
  return <section className="panel root-panel" aria-labelledby="root-title">
    <div className="section-heading"><span className="section-index" aria-hidden="true">05</span><h2 id="root-title" ref={title} tabIndex={-1}>ROOT REBIRTH</h2></div>
    <p>現周回のSCORE 1E18で選べる根源転生です。自動では実行しません。通常転生（1E18到達で6pt）も選べます。</p>
    <dl className="root-stats">
      <div><dt>ROOT結晶</dt><dd><output aria-label="ROOT結晶">{formatNumber(permanent.unspentRootCrystals)}</output> 個</dd></div>
      <div><dt>ROOT回数</dt><dd><output aria-label="ROOT回数">{formatNumber(permanent.rootRebirthCount)}</output> 回</dd></div>
      <div><dt>累計獲得 / 使用</dt><dd>{formatNumber(permanent.totalRootCrystalsEarned)} / {formatNumber(permanent.totalRootCrystalsSpent)} 個</dd></div>
    </dl>
    <p>次回報酬: ROOT結晶 {quote.nextCrystals}個。回数ボーナスは全生産 ×{formatNumber(getRootCountMultiplier(permanent.rootRebirthCount))} → ×{formatNumber(getRootCountMultiplier(gn(permanent.rootRebirthCount).add(1)))}。初回は×3、2回目は×5です。ROOT強化・装備は別に合成します。</p>
    <button type="button" className="secondary-button" ref={trigger} disabled={isPaused || !quote.canRebirth} aria-describedby="root-rebirth-reason" onClick={() => { setError(false); setConfirming(true); }}>ROOT REBIRTHする</button>
    <p id="root-rebirth-reason">{isPaused ? 'セーブ確認のためROOTを停止しています。' : quote.reason ?? 'ROOT結晶1個を獲得できます。リセット・保持範囲を確認して選んでください。'}</p>
    <details className="root-reset-scope"><summary>リセット・引継ぎ範囲</summary><RootResetScope permanent={permanent} /></details>
    {permanent.equipmentSystemUnlocked && <>
      <aside className="root-equipment-gate" aria-label="装備システム解禁">
        {permanent.rootRebirthCount === 1 && notice?.startsWith('初回ROOT') && <svg className="root-discovery" viewBox="0 0 80 56" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M40 4l15 16-15 16-15-16zM40 36v16M40 40l-15 9M40 44l15 9M25 20H9M55 20h16M22 9l-8-5M58 9l8-5" /></svg>}
        <h3>装備システム解禁</h3><p>下の装備欄で利用可能SCOREを使い、恒久装備を解禁できます。全解禁装備の常時効果を重ねて適用します。</p>
      </aside>
      <h3>ROOT恒久強化</h3>
      <p>ROOT結晶は芋・SCORE・通常ポイントとは別です。初回1個は全体生産か設備割引・次回初期支給に使えます。購入の振り直しはありません。温存も選べます。</p>
      <p>ROOT由来の全収穫 ×{formatNumber(root.production)} / 後期設備・掘削 ×{root.lateAndDig} / 次回の追加初期芋 {formatNumber(root.startingImo)}。</p>
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
      <h2 id="root-rebirth-dialog-title" tabIndex={-1}>ROOT REBIRTH：ROOT結晶 {quote.crystals}個を獲得</h2>
      <RootResetScope permanent={permanent} />
      <p>通常転生は同時に実行しません。通常転生回数・通常ポイントは増えません。次回の初期所持芋はROOT強化だけから計算し、SCOREへ加算しません。</p>
      {permanent.rootRebirthCount === 0 && <p>初回ROOTの回数ボーナスは全収穫×3です。新しい恒久機能は実行後に公開します。</p>}
      {error && <p role="alert">ROOTできませんでした。最新のSCOREとセーブ状態を確認してください。</p>}
      <div className="confirmation-actions">
        <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>キャンセル</button>
        <button type="button" className="secondary-button" disabled={isPaused || !quote.canRebirth} onClick={() => { if (onRebirth()) setConfirming(false); else setError(true); }}>ROOTを実行（結晶{quote.crystals}個）</button>
      </div>
    </dialog>}
  </section>;
}

function RootResetScope({ permanent }: { readonly permanent: PermanentProgress }) {
  const spent = getSkillPointsSpent(permanent.skillRanks), lost = spent + permanent.unspentPoints;
  return <>
    <p><strong>リセット:</strong> 今ROOTの通常転生回数・未使用ポイント・全5種類の通常スキル（心得・自動管理を含む）を0にします。現周回SCORE・利用可能SCORE・支出内訳・所持芋・設備・SCORE上限段階・現ROOT周回の深層解析完了状態と突破/解析権・スキル割当上限の到達段階・周回研究・生産端数・再購入制限も初期状態へ戻します。</p>
    <p>通常ポイントは使用中{spent}pt＋未使用{permanent.unspentPoints}pt＝<strong>{lost}pt消失</strong>し、ROOT消失履歴へ記録します。通常転生報酬・通常転生回数は付与しません。</p>
    <p><strong>保持:</strong> 生涯の通常転生回数・獲得/消失ポイント台帳・生涯解析回数と深層記憶・発見済みの名称・DEPTHと端数・恒久掘削研究・ROOT回数/結晶/恒久強化{permanent.equipmentSystemUnlocked ? '・恒久装備とモード/プリセット・装備の発見履歴' : ''}。</p>
    <p>初回ROOTで自動購入を恒久解禁し、ON/OFF・個別設定・方針・優先順を保持します。自動管理ランク0でも設定ONなら動作します。心得は新ROOTで通常転生を重ねて再取得し、解析もやり直します。再開時の芋はROOT強化の恒久支給分だけです。</p>
  </>;
}
