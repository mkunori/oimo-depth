import { useState } from 'react';
import { EquipmentIcon } from '../../components/EquipmentIcon';
import { formatMultiplier, formatNumber } from '../../components/formatNumber';
import { getEquipmentAvailability, getEquipmentMilestones, getEquipmentPrice, getEquipmentProductionPerUnit, getPurchaseQuote, getRootLink, isEquipmentDiscovered } from '../../core/game';
import type { PurchaseMode } from '../../core/game';
import type { GameState } from '../../core/state';
import { EQUIPMENT, EQUIPMENT_IDS } from '../../data/equipment';
import type { EquipmentId } from '../../data/equipment';
import type { SessionSnapshot } from '../save/GameSession';
import { AutomationPanel } from './AutomationPanel';
import type { AutomationSettings } from '../../data/automation';

interface ShopProps {
  readonly state: GameState;
  readonly isCapped: boolean;
  readonly isPaused: boolean;
  readonly onPurchase: (id: EquipmentId, mode: PurchaseMode) => void;
  readonly milestoneNotice: SessionSnapshot['milestoneNotice'];
  readonly automaticPurchases: number;
  readonly onAutomationChange: (settings: AutomationSettings) => boolean;
}

export function Shop({ state, isCapped, isPaused, onPurchase, milestoneNotice, automaticPurchases, onAutomationChange }: ShopProps) {
  const [mode, setMode] = useState<PurchaseMode>(1);
  const link = getRootLink(state.equipmentCounts);

  return (
    <section className="shop-panel panel" aria-labelledby="shop-title">
      <div className="section-heading">
        <span className="section-index" aria-hidden="true">02</span>
        <h2 id="shop-title">設備</h2>
        <span className="section-caption">収穫を、もっと速く。</span>
      </div>
      <AutomationPanel state={state} isPaused={isPaused} automaticPurchases={automaticPurchases} onChange={onAutomationChange} />
      <fieldset className="purchase-modes">
        <legend>購入倍率</legend>
        <div className="mode-options">
          {([1, 10, 'MAX'] as const).map((value) => (
            <label className="mode-option" key={value}>
              <input type="radio" name="purchase-mode" value={value} checked={mode === value} onChange={() => setMode(value)} />
              <span>{value === 'MAX' ? 'MAX' : `×${value}`}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="shop-note">×10 は最大10台、MAX は買えるだけ購入します。</p>
      {state.permanent.maxDiscoveredStage >= 3 && <aside className="root-link-summary" aria-label="設備連携">
        <h3>設備連携</h3>
        <p>根脈中継塔2台＋芋核培養槽1台で1組。連携 <output aria-label="設備連携の組数">{formatNumber(link.linked)}</output>組 / 追加生産 {formatNumber(link.baseProduction)} 芋/秒（倍率適用前）。全体・地層倍率を適用し、地脈共鳴は対象外です。</p>
        <p>未接続: 中継塔 {formatNumber(link.unconnectedRelays)}台・培養槽 {formatNumber(link.unconnectedChambers)}台。次の連携に中継塔 あと{link.nextRelays}台・培養槽 あと{link.nextChambers}台。</p>
        {state.scoreCapStage < 3 && <p>この周回は上限段階の再突破が必要です。</p>}
      </aside>}
      {milestoneNotice && <p className="milestone-notice" role="status">{EQUIPMENT[milestoneNotice.id].name}: {milestoneNotice.counts.join('・')}台のマイルストーン達成！ 現在 ×{formatMultiplier(milestoneNotice.multiplier)}</p>}
      <ul className="equipment-list">
        {EQUIPMENT_IDS.filter((id) => isEquipmentDiscovered(id, state)).map((id) => {
          const definition = EQUIPMENT[id];
          const quote = getPurchaseQuote(state, id, mode);
          const nextPrice = getEquipmentPrice(id, state.equipmentCounts[id], state.permanent);
          const availability = getEquipmentAvailability(id, state);
          const milestone = getEquipmentMilestones(id, state.equipmentCounts[id]);
          const disabled = !availability.unlocked || isPaused || isCapped || quote.quantity === 0;
          return (
            <li key={id}>
              <article className="equipment" aria-labelledby={`${id}-title`}>
                <div className="equipment-icon"><EquipmentIcon id={id} /></div>
                <div className="equipment-details">
                  <div className="equipment-heading">
                    <h3 id={`${id}-title`}>{definition.name}</h3>
                    {!availability.unlocked && <span className="locked-label">未解禁</span>}
                    <span className="owned-count">所有 <output aria-label={`${definition.name}の所有数`} aria-live="off">{formatNumber(state.equipmentCounts[id])}</output> 台</span>
                  </div>
                  <p className="equipment-effect">1台あたり +{formatNumber(getEquipmentProductionPerUnit(id, state.permanent, state.equipmentCounts[id], state.researchRanks))} 芋 / 秒</p>
                  {definition.milestones.length > 0 && <p className="equipment-milestone">台数倍率 ×{formatMultiplier(milestone.multiplier)}<br />{milestone.next ? `次の目標 ${milestone.next.count}台 → ×${formatMultiplier(milestone.nextMultiplier!)}` : 'すべての台数ボーナスを達成'}</p>}
                  <p className="equipment-price">次の1台 <strong>{formatNumber(nextPrice)} 芋</strong></p>
                </div>
                <button
                  type="button"
                  className="purchase-button"
                  disabled={disabled}
                  aria-label={disabled ? `${definition.name}を購入` : `${definition.name}を${quote.quantity}台購入`}
                  aria-describedby={`${id}-reason`}
                  onClick={() => onPurchase(id, mode)}
                >
                  <span>{!availability.unlocked ? '未解禁' : disabled ? '購入できません' : `${quote.quantity}台を購入`}</span>
                  {!disabled && <strong>{formatNumber(quote.totalCost)} 芋</strong>}
                </button>
                <p id={`${id}-reason`} className={`purchase-reason ${disabled ? '' : 'is-available'}`}>
                  {isPaused ? 'セーブの確認が必要なため購入を停止しています。' : !availability.unlocked ? `限界突破後、SCORE 上限 ${formatNumber(availability.requiredScoreCap)} の段階で解禁します。` : isCapped ? 'SCORE 上限到達のため購入を停止しています。' : quote.quantity === 0 ? '所持芋が足りません。' : '所持芋を使って購入できます。'}
                </p>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
