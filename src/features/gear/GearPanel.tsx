import { GearModeControls } from './GearModeControls';
import type { GearControlProps } from './GearModeControls';
import type { GameState } from '../../core/state';
import { GEAR, GEAR_IDS } from '../../data/gear';
import type { GearId } from '../../data/gear';
import { getGearUnlock } from '../../core/gear';
import { getGearMultiplier, getSpendableScore } from '../../core/gearProgress';
import { formatMultiplier, formatNumber } from '../../components/formatNumber';
import { GearIcon } from '../../components/GearIcon';

export function GearPanel({ state, isPaused, onUnlock, ...controls }: GearControlProps & {
  readonly state: GameState; readonly isPaused: boolean; readonly onUnlock: (id: GearId) => boolean;
}) {
  if (!state.permanent.equipmentSystemUnlocked) return state.permanent.maxDiscoveredStage >= 4
    ? <p className="shop-note gear-lock-note">初めてROOT REBIRTHを実行すると、装備の恒久解禁を利用できます。</p> : null;
  const visible = GEAR_IDS.filter((id) => state.permanent.gearDiscovered[id]);
  const next = GEAR_IDS.find((id) => !state.permanent.gearDiscovered[id]);
  const count = GEAR_IDS.filter((id) => state.permanent.gearUnlocked[id]).length;
  return <section className="panel gear-panel" aria-labelledby="gear-title">
    <div className="section-heading"><span className="section-index" aria-hidden="true">06</span><h2 id="gear-title">装備</h2></div>
    <p>利用可能SCOREで一度だけ恒久解禁します。累計SCORE・所持芋・ROOT結晶は減りません。解禁した全装備が常時有効で、通常転生・ROOT後も保持します。</p>
    <dl className="root-stats">
      <div><dt>累計SCORE</dt><dd><output aria-label="装備欄の累計SCORE">{formatNumber(state.runEarnedScore)}</output></dd></div>
      <div><dt>利用可能SCORE</dt><dd><output aria-label="利用可能SCORE">{formatNumber(getSpendableScore(state))}</output></dd></div>
      <div><dt>この周回の装備支出</dt><dd><output aria-label="装備支出SCORE">{formatNumber(state.scoreSpentThisRun)}</output></dd></div>
    </dl>
    <p>常時有効 <output aria-label="有効な装備数">{count}</output>点 / 装備由来の全生産 ×{formatMultiplier(getGearMultiplier(state.permanent))}。基礎生産・全設備・リンク追加生産に適用します。</p>
    <GearModeControls state={state} isPaused={isPaused} {...controls} />
    <div className="research-nodes">
      {visible.map((id) => {
        const definition = GEAR[id], quote = getGearUnlock(state, id), owned = state.permanent.gearUnlocked[id];
        return <article className="research-node gear-node" key={id} aria-labelledby={`gear-${id}`}>
          <div className="gear-heading"><GearIcon id={id} /><h3 id={`gear-${id}`}>{definition.name}</h3></div>
          <p>常時効果: 全生産 ×{definition.passive.productionMultiplier}</p>
          <p>必要ROOT {definition.minimumRootCount}回 / 価格 {formatNumber(definition.price)} SCORE</p>
          <button type="button" className="secondary-button" disabled={isPaused || !quote.canUnlock} aria-describedby={`gear-${id}-reason`} onClick={() => onUnlock(id)}>{owned ? `${definition.name}は恒久解禁済み` : `${definition.name}を恒久解禁`}</button>
          <p id={`gear-${id}-reason`}>{isPaused ? 'セーブ確認のため装備解禁を停止しています。' : quote.reason ?? '利用可能SCOREを使って解禁できます。上限到達後も解禁でき、収穫停止は維持します。'}</p>
        </article>;
      })}
    </div>
    {next && <p className="gear-next">次の装備: ？？？ — ROOT {GEAR[next].minimumRootCount}回と対応する突破段階で発見します。</p>}
    <p className="shop-note">周回リセットでは利用可能SCOREと支出内訳をリセットします。モード・プリセットも転生・ROOT後に保持します。</p>
  </section>;
}
