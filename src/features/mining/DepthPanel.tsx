import { formatNumber } from '../../components/formatNumber';
import { getDigPower, getDigSpeed, getStratum, getEffectiveHardness } from '../../core/excavation';
import { getDigResearchPurchase } from '../../core/digResearch';
import { DEPTH_REWARDS, DIG_RESEARCH, DIG_RESEARCH_IDS, STRATA } from '../../data/depth';
import type { DigResearchId } from '../../data/depth';
import type { GameState } from '../../core/state';

interface Props { readonly state: GameState; readonly isStopped: boolean; readonly notice: string | null; readonly onPurchase: (id: DigResearchId) => boolean }
const meters = (value: number) => new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3, roundingMode: 'floor' }).format(value);
const speedText = (value: number) => new Intl.NumberFormat('ja-JP', { maximumSignificantDigits: 4 }).format(value);
export function DepthPanel({ state, isStopped, notice, onPurchase }: Props) {
  const depth = state.permanent.depthMeters, index = getStratum(depth), stratum = STRATA[index]!;
  const next = STRATA[index + 1];
  const discovered = DEPTH_REWARDS.filter((reward) => depth >= reward.depth);
  return <section className="depth-panel" aria-labelledby="depth-title">
    <h3 id="depth-title"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 8h38M5 19h38M5 32h38M5 43h38M24 4v35m-6-6 6 6 6-6" /></svg>地下を開拓する</h3>
    <dl className="depth-stats"><div><dt>DEPTH</dt><dd><output aria-label="DEPTH" aria-live="off">{meters(depth)}</output> m</dd></div><div><dt>掘削速度</dt><dd><output aria-label="掘削速度" aria-live="off">{speedText(isStopped ? 0 : getDigSpeed(state))}</output> m/s</dd></div></dl>
    <p>現在の地層: <strong>{stratum.name}</strong> / 硬さ ×{getEffectiveHardness(state.permanent)}</p>
    <p>{next ? `次の発見 ？？？ まで ${meters(Math.max(0, next.start - depth))} m（深度 ${formatNumber(next.start)} m）` : '現在知られている最深の地層です。SCORE稼働中はこの先も掘れます。'}</p>
    {notice && <p className="progress-notice depth-notice" role="status">{notice}</p>}
    <p className="shop-note">掘削力 {speedText(getDigPower(state))} ÷ 地層の硬さ。SCORE上限中は深度も停止します。転生・突破で深度と掘削研究を保持し、SCOREや芋へ変換しません。</p>
    {depth >= 10 && <details className="depth-discoveries"><summary>地層図鑑・到達記録（{discovered.length}件）</summary>
      <ul>{STRATA.filter((layer) => layer.start <= depth).map((layer) => <li key={layer.start}>{layer.name} / {formatNumber(layer.start)} m〜 / 硬さ ×{layer.hardness}</li>)}</ul>
      <ul>{discovered.map((reward) => <li key={reward.depth}><strong>{reward.name}</strong>（{formatNumber(reward.depth)} m）<p>{reward.description}</p></li>)}</ul>
      <p className="shop-note">記録・解禁は恒久の到達深度から判定します。受取操作や重複する芋・ポイント報酬はありません。</p>
    </details>}
    {depth >= 100 && <details className="depth-research"><summary>掘削研究（任意・恒久）</summary>
      <p>各ランクで掘削力×2。所持芋のみ消費し、SCOREと芋の生産式は変わりません。返金・自動購入はありません。</p>
      {DIG_RESEARCH_IDS.filter((id) => depth >= DIG_RESEARCH[id].unlockDepth).map((id) => {
        const quote = getDigResearchPurchase(state, id);
        return <div className="dig-research-node" key={id}><h4>{DIG_RESEARCH[id].name} — ランク {quote.rank}/3</h4>
          <button type="button" className="secondary-button" disabled={isStopped || !quote.canPurchase} onClick={() => onPurchase(id)}>{DIG_RESEARCH[id].name}を強化{quote.cost ? `（${formatNumber(quote.cost)} 芋）` : ''}</button>
          <p>{quote.reason ?? '次のランクで掘削力×2。転生・深層解析でも保持します。'}</p>
        </div>;
      })}
    </details>}
  </section>;
}
