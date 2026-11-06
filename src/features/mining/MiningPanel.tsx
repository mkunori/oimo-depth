import { formatNumber } from '../../components/formatNumber';
import { getEquipmentAvailability, getEquipmentPrice } from '../../core/game';
import { getScoreCap } from '../../data/scoreCaps';
import { canBreakthrough } from '../../core/breakthrough';
import { BreakthroughControl } from '../prestige/BreakthroughControl';
import type { GameState } from '../../core/state';
import { EQUIPMENT, EQUIPMENT_IDS } from '../../data/equipment';
import { getPrestigeReward } from '../../core/prestige';

interface MiningPanelProps {
  readonly state: GameState;
  readonly production: number;
  readonly isCapped: boolean;
  readonly isPaused: boolean;
  readonly onBreakthrough: () => boolean;
}

export function MiningPanel({ state, production, isCapped, isPaused, onBreakthrough }: MiningPanelProps) {
  const scoreCap = getScoreCap(state);
  const affordable = EQUIPMENT_IDS.find(
    (id) => getEquipmentAvailability(id, state).unlocked && getEquipmentPrice(id, state.equipmentCounts[id], state.permanent) <= state.imo,
  );
  const goal = isPaused ? '進行を一時停止しています。セーブ管理の案内を確認してください。' : isCapped
    ? canBreakthrough(state) ? '限界突破でこの周回を続けるか、転生で2ptを獲得して次の周回へ進めます。'
      : state.scoreCapStage === 1 ? 'SCORE 1E9到達。次の桁の突破は未実装です。通常転生で次の周回へ進めます。'
        : '転生で2ptを獲得し、スキルを強化して限界突破を解禁しましょう。'
    : getPrestigeReward(state) > 0 ? state.scoreCapStage === 1 ? '上位設備を増やしてSCORE 1E9へ進みましょう。通常転生も2ptで選べます。' : '転生できます。SCORE 1,000,000以上なら2ptになります。' : affordable
      ? `${EQUIPMENT[affordable].name}を購入できます。設備を増やして、収穫を速くしましょう。`
      : `芋を貯めて、次の設備を購入しましょう。SCORE ${formatNumber(scoreCap)} が今回の目標です。`;

  return (
    <section className="mining-panel panel" aria-labelledby="mining-title">
      <div className="section-heading">
        <span className="section-index" aria-hidden="true">01</span>
        <h2 id="mining-title">採掘</h2>
        <span className="section-caption">少しずつ、深く。</span>
      </div>
      <dl className="harvest-stats">
        <div className="balance-stat">
          <dt>所持芋</dt>
          <dd><output aria-label="所持芋" aria-live="off">{formatNumber(state.imo)}</output><span className="unit">芋</span></dd>
        </div>
        <div className="rate-stat">
          <dt>収穫速度</dt>
          <dd><output aria-label="収穫速度" aria-live="off">{formatNumber(isCapped || isPaused ? 0 : production)}</output><span className="unit">芋 / 秒</span></dd>
        </div>
      </dl>
      <div className="score-block">
        <div className="score-heading">
          <label htmlFor="score-progress">SCORE</label>
          <span><output aria-label="現在SCORE" aria-live="off">{formatNumber(state.runEarnedScore)}</output> / <output aria-label="SCORE上限">{formatNumber(scoreCap)}</output></span>
        </div>
        <progress id="score-progress" value={state.runEarnedScore} max={scoreCap} />
        <p className="score-note">この周回の累計収穫。設備を買っても減りません。</p>
        {state.runStartingImo > 0 && <p className="score-note">開始時の支給芋 {formatNumber(state.runStartingImo)} は SCORE に含みません。</p>}
      </div>
      <p className={`mining-status ${isCapped ? 'is-capped' : ''}`} role="status">
        <span className="status-dot" aria-hidden="true" />
        {isPaused ? 'セーブの確認が必要です — 採掘を一時停止しています' : isCapped ? '上限到達 — 収穫が停止しました' : '自動採掘中 — 芋を収穫しています'}
      </p>
      {isCapped && <p className="capacity-note">設備の生産能力は {formatNumber(production)} 芋 / 秒です。SCORE 上限のため、これ以上は収穫できません。</p>}
      <aside className="next-goal" aria-labelledby="goal-title">
        <h3 id="goal-title">次の目標</h3>
        <p>{goal}</p>
      </aside>
      <BreakthroughControl state={state} isPaused={isPaused} onBreakthrough={onBreakthrough} />
    </section>
  );
}
