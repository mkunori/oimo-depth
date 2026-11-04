import { useState } from 'react';
import { EquipmentIcon } from '../../components/EquipmentIcon';
import { formatNumber } from '../../components/formatNumber';
import { getEquipmentPrice, getPurchaseQuote } from '../../core/game';
import type { PurchaseMode } from '../../core/game';
import type { GameState } from '../../core/state';
import { EQUIPMENT, EQUIPMENT_IDS } from '../../data/equipment';
import type { EquipmentId } from '../../data/equipment';

interface ShopProps {
  readonly state: GameState;
  readonly isCapped: boolean;
  readonly isPaused: boolean;
  readonly onPurchase: (id: EquipmentId, mode: PurchaseMode) => void;
}

export function Shop({ state, isCapped, isPaused, onPurchase }: ShopProps) {
  const [mode, setMode] = useState<PurchaseMode>(1);

  return (
    <section className="shop-panel panel" aria-labelledby="shop-title">
      <div className="section-heading">
        <span className="section-index" aria-hidden="true">02</span>
        <h2 id="shop-title">設備</h2>
        <span className="section-caption">収穫を、もっと速く。</span>
      </div>
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
      <ul className="equipment-list">
        {EQUIPMENT_IDS.map((id) => {
          const definition = EQUIPMENT[id];
          const quote = getPurchaseQuote(state, id, mode);
          const nextPrice = getEquipmentPrice(id, state.equipmentCounts[id]);
          const disabled = isPaused || isCapped || quote.quantity === 0;
          return (
            <li key={id}>
              <article className="equipment" aria-labelledby={`${id}-title`}>
                <div className="equipment-icon"><EquipmentIcon id={id} /></div>
                <div className="equipment-details">
                  <div className="equipment-heading">
                    <h3 id={`${id}-title`}>{definition.name}</h3>
                    <span className="owned-count">所有 <output aria-label={`${definition.name}の所有数`} aria-live="off">{formatNumber(state.equipmentCounts[id])}</output> 台</span>
                  </div>
                  <p className="equipment-effect">1台あたり +{formatNumber(definition.productionPerUnit)} 芋 / 秒</p>
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
                  <span>{disabled ? '購入できません' : `${quote.quantity}台を購入`}</span>
                  {!disabled && <strong>{formatNumber(quote.totalCost)} 芋</strong>}
                </button>
                <p id={`${id}-reason`} className={`purchase-reason ${disabled ? '' : 'is-available'}`}>
                  {isPaused ? 'セーブの確認が必要なため購入を停止しています。' : isCapped ? 'SCORE 上限到達のため購入を停止しています。' : quote.quantity === 0 ? '所持芋が足りません。' : '所持芋を使って購入できます。'}
                </p>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
