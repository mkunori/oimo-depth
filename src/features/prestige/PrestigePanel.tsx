import { useEffect, useRef, useState } from 'react';
import { formatNumber } from '../../components/formatNumber';
import { getPrestigeReward } from '../../core/prestige';
import { getSkillBonuses, getSkillPurchase } from '../../core/skills';
import type { GameState } from '../../core/state';
import { INITIAL_BALANCE } from '../../data/balance';
import { PRESTIGE_BALANCE, SKILLS, SKILL_IDS } from '../../data/skills';
import { isEnhancementSkill } from '../../data/skills';
import { getDeepMemorySlots } from '../../core/research';
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
  if (type === 'breakthrough') return rank > 0 ? 'SCORE 1,000,000で上限1E9への限界突破が可能' : '限界突破は未解禁';
  if (type === 'automation') return rank > 0 ? 'オンライン・オフラインの自動購入を設定可能（初期OFF）' : '自動購入は未解禁';
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
        <p>SCORE {formatNumber(PRESTIGE_BALANCE.unlockScore)} で転生解禁。SCORE {formatNumber(INITIAL_BALANCE.scoreCap)} 未満なら1pt、以上なら2ptを獲得します。突破後も報酬は2ptです。</p>
        <p>転生すると所持芋・今周回のSCORE・設備をリセットし、上限を1,000,000に戻します。転生回数・未使用ポイント・スキル・突破権は引き継ぎます。</p>
        <p className="shop-note">深層記憶: 解析累計 {formatNumber(state.permanent.deepResearchCount)}回 / 保持枠 {getDeepMemorySlots(state.permanent.deepResearchCount)}/3。{state.permanent.deepResearchCount < 4 ? `あと${4 - state.permanent.deepResearchCount}回の解析で強化スキルを全保持。` : '強化スキルを全保持できます。'} 通常転生で強化スキルの再購入制限を解除します。</p>
        <p className="prestige-reward">獲得見込み: <output aria-label="獲得見込みポイント" aria-live="off">{reward}</output> pt</p>
        <button type="button" ref={trigger} className="secondary-button" disabled={isPaused || reward === 0} onClick={() => { setConfirmationError(null); setConfirming(true); }} aria-describedby="prestige-reason">転生する</button>
        <p id="prestige-reason" className="shop-note">{isPaused ? 'セーブの確認が必要なため転生を停止しています。' : reward === 0 ? `SCORE ${formatNumber(PRESTIGE_BALANCE.unlockScore)} まで採掘しましょう。` : '転生後は下のスキルで次の周回を強化できます。'}</p>
        {notice && <p className="progress-notice" role="status">{notice}</p>}
      </div>
      <div className="skill-tree" aria-label="基本スキルツリー">
        {SKILL_IDS.map((id) => {
          const definition = SKILLS[id];
          const rank = state.permanent.skillRanks[id];
          const quote = getSkillPurchase(state.permanent, id, state.postDeepResearchSkillLock);
          return (
            <article className="skill-node" key={id} aria-labelledby={`${id}-skill-title`}>
              <div className="skill-heading"><h3 id={`${id}-skill-title`}>{definition.name}</h3><span>ランク <output aria-label={`${definition.name}のランク`} aria-live="off">{rank}</output> / {definition.maxRank}</span></div>
              <p className="shop-note">{isEnhancementSkill(id) ? '強化型 — 深層解析の保持枠外ならリセット' : '機能解禁型 — 深層解析でも保持'}</p>
              <p>現在: {skillEffect(id, rank)}</p>
              {rank < definition.maxRank && <p>次の効果: {skillEffect(id, quote.nextRank)}</p>}
              <p className="skill-prerequisites">取得時の前提: {definition.prerequisites.length === 0 ? 'なし' : definition.prerequisites.map((required) => `${SKILLS[required.id].name} ランク${required.rank}`).join('、')}{definition.minimumPrestigeCount > 0 && `、累計転生${definition.minimumPrestigeCount}回以上`}</p>
              <button type="button" className="secondary-button" disabled={isPaused || !quote.canPurchase} aria-label={`${definition.name}を強化`} aria-describedby={`${id}-skill-reason`} onClick={() => onBuySkill(id)}>{quote.cost === null ? '最大ランク' : `${quote.cost}ptで強化`}</button>
              <p className="shop-note" id={`${id}-skill-reason`}>{isPaused ? 'セーブの確認が必要なため強化を停止しています。' : quote.reason ?? (id === 'startingImo' ? '次の転生から適用されます。SCORE には加算しません。' : id === 'breakthrough' ? '取得後、採掘欄の「限界突破する」から現在の周回を継続できます。' : id === 'automation' ? '取得後、設備欄の「自動購入」でONにしてください。取得だけでは購入しません。' : '取得するとすぐに効果が反映されます。')}</p>
            </article>
          );
        })}
      </div>
      <p className="shop-note">現在の収穫倍率 ×{formatNumber(bonuses.productionMultiplier)} / 通常スキルの設備割引 {formatNumber(bonuses.equipmentDiscountPercent)}% / 次周回の初期所持芋 {formatNumber(bonuses.startingImo)} 芋。スキル取得だけでは上限は変わりません。限界突破は採掘欄で実行します。</p>
      {confirming && (
        <dialog ref={dialog} className="prestige-dialog" aria-labelledby="prestige-dialog-title" aria-describedby="prestige-dialog-description" onCancel={() => setConfirming(false)}>
          <h2 id="prestige-dialog-title">転生して次の周回へ進みますか？</h2>
          <p id="prestige-dialog-description">現在の所持芋・SCORE・設備がリセットされ、SCORE上限は1,000,000に戻ります。取り消せません。転生回数・ポイント・スキル・突破権は引き継ぎます。上限に再到達すれば追加ポイントなしで再突破できます。</p>
          <p>獲得する転生ポイント: <strong>{reward} pt</strong></p>
          <p>再開時の所持芋 {formatNumber(bonuses.startingImo)} / SCORE 0</p>
          {state.permanent.equipmentSystemUnlocked && <p>利用可能SCOREと支出内訳を0へ戻し、恒久装備・装備の発見履歴を保持します。</p>}
          <p>深層記憶の解析累計 {formatNumber(state.permanent.deepResearchCount)}回を保持し、強化スキルの再購入制限を解除します。</p>
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
