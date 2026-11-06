import { useEffect, useRef, useState } from 'react';
import { formatNumber } from '../../components/formatNumber';
import { getPrestigeReward } from '../../core/prestige';
import { getSkillBonuses, getSkillPurchase } from '../../core/skills';
import type { GameState } from '../../core/state';
import { INITIAL_BALANCE } from '../../data/balance';
import { PRESTIGE_BALANCE, SKILLS, SKILL_IDS } from '../../data/skills';
import type { SkillId } from '../../data/skills';

interface PrestigePanelProps {
  readonly state: GameState;
  readonly isPaused: boolean;
  readonly notice: string | null;
  readonly onPrestige: (expectedReward: number) => boolean;
  readonly onBuySkill: (id: SkillId) => boolean;
}

function skillEffect(id: SkillId, rank: number): string {
  const { type, perRank } = SKILLS[id].effect;
  if (type === 'harvest') return `収穫量 ×${formatNumber(1 + rank * perRank)}`;
  if (type === 'discount') return `設備価格 ${formatNumber(rank * perRank)}%割引`;
  return `次の転生後の初期所持芋 ${formatNumber(rank * perRank)} 芋`;
}

export function PrestigePanel({ state, isPaused, notice, onPrestige, onBuySkill }: PrestigePanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const reward = getPrestigeReward(state);
  const bonuses = getSkillBonuses(state.permanent);

  useEffect(() => {
    if (!confirming || !dialog.current) return;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); trigger.current?.focus(); };
  }, [confirming]);

  return (
    <section className="prestige-panel panel" aria-labelledby="prestige-title">
      <div className="section-heading"><span className="section-index" aria-hidden="true">03</span><h2 id="prestige-title">転生とスキル</h2><span className="section-caption">次の一周を、もっと速く。</span></div>
      <div className="prestige-summary">
        <dl className="permanent-stats">
          <div><dt>累計転生回数</dt><dd><output aria-label="累計転生回数" aria-live="off">{formatNumber(state.permanent.prestigeCount)}</output> 回</dd></div>
          <div><dt>未使用ポイント</dt><dd><output aria-label="未使用ポイント" aria-live="off">{formatNumber(state.permanent.unspentPoints)}</output> pt</dd></div>
        </dl>
        <p>SCORE {formatNumber(PRESTIGE_BALANCE.unlockScore)} で転生解禁。上限未満なら1pt、上限 {formatNumber(INITIAL_BALANCE.scoreCap)} なら2ptを獲得します。</p>
        <p>転生すると所持芋・今周回のSCORE・設備をリセットし、転生回数・未使用ポイント・スキルを引き継ぎます。</p>
        <p className="prestige-reward">獲得見込み: <output aria-label="獲得見込みポイント" aria-live="off">{reward}</output> pt</p>
        <button type="button" ref={trigger} className="secondary-button" disabled={isPaused || reward === 0} onClick={() => { setConfirmationError(null); setConfirming(true); }} aria-describedby="prestige-reason">転生する</button>
        <p id="prestige-reason" className="shop-note">{isPaused ? 'セーブの確認が必要なため転生を停止しています。' : reward === 0 ? `SCORE ${formatNumber(PRESTIGE_BALANCE.unlockScore)} まで採掘しましょう。` : '転生後は下のスキルで次の周回を強化できます。'}</p>
        {notice && <p className="progress-notice" role="status">{notice}</p>}
      </div>
      <div className="skill-tree" aria-label="基本スキルツリー">
        {SKILL_IDS.map((id) => {
          const definition = SKILLS[id];
          const rank = state.permanent.skillRanks[id];
          const quote = getSkillPurchase(state.permanent, id);
          return (
            <article className="skill-node" key={id} aria-labelledby={`${id}-skill-title`}>
              <div className="skill-heading"><h3 id={`${id}-skill-title`}>{definition.name}</h3><span>ランク <output aria-label={`${definition.name}のランク`} aria-live="off">{rank}</output> / {definition.maxRank}</span></div>
              <p>現在: {skillEffect(id, rank)}</p>
              {rank < definition.maxRank && <p>次の効果: {skillEffect(id, quote.nextRank)}</p>}
              <p className="skill-prerequisites">前提: {definition.prerequisites.length === 0 ? 'なし' : definition.prerequisites.map((required) => `${SKILLS[required.id].name} ランク${required.rank}`).join('、')}</p>
              <button type="button" className="secondary-button" disabled={isPaused || !quote.canPurchase} aria-label={`${definition.name}を強化`} aria-describedby={`${id}-skill-reason`} onClick={() => onBuySkill(id)}>{quote.cost === null ? '最大ランク' : `${quote.cost}ptで強化`}</button>
              <p className="shop-note" id={`${id}-skill-reason`}>{isPaused ? 'セーブの確認が必要なため強化を停止しています。' : quote.reason ?? (id === 'startingImo' ? '次の転生から適用されます。SCORE には加算しません。' : '取得するとすぐに効果が反映されます。')}</p>
            </article>
          );
        })}
      </div>
      <p className="shop-note">現在の収穫倍率 ×{formatNumber(bonuses.productionMultiplier)} / 設備割引 {formatNumber(bonuses.equipmentDiscountPercent)}% / 次周回の初期所持芋 {formatNumber(bonuses.startingImo)} 芋。SCORE 上限は変わりません。</p>
      {confirming && (
        <dialog ref={dialog} className="prestige-dialog" aria-labelledby="prestige-dialog-title" aria-describedby="prestige-dialog-description" onCancel={() => setConfirming(false)}>
          <h2 id="prestige-dialog-title">転生して次の周回へ進みますか？</h2>
          <p id="prestige-dialog-description">現在の所持芋・SCORE・設備がリセットされます。取り消せません。転生回数・ポイント・スキルは引き継ぎます。</p>
          <p>獲得する転生ポイント: <strong>{reward} pt</strong></p>
          <p>再開時の所持芋 {formatNumber(bonuses.startingImo)} / SCORE 0</p>
          {confirmationError && <p role="alert">{confirmationError}</p>}
          <div className="confirmation-actions">
            <button type="button" className="secondary-button" onClick={() => setConfirming(false)} autoFocus>キャンセル</button>
            <button type="button" className="secondary-button" disabled={isPaused || reward === 0} onClick={() => {
              if (onPrestige(reward)) setConfirming(false);
              else setConfirmationError('転生できませんでした。最新の報酬とセーブ状態を確認して、もう一度実行してください。');
            }}>転生を実行（{reward}pt）</button>
          </div>
        </dialog>
      )}
    </section>
  );
}
