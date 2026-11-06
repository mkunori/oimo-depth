import { AUTOMATION_POLICIES } from '../../data/automation';
import type { AutomationPolicy, AutomationSettings } from '../../data/automation';
import { EQUIPMENT, EQUIPMENT_IDS } from '../../data/equipment';
import type { EquipmentId } from '../../data/equipment';
import { getEquipmentAvailability } from '../../core/game';
import type { GameState } from '../../core/state';

interface Props {
  readonly state: GameState;
  readonly isPaused: boolean;
  readonly automaticPurchases: number;
  readonly onChange: (settings: AutomationSettings) => boolean;
}

export function AutomationPanel({ state, isPaused, automaticPurchases, onChange }: Props) {
  const settings = state.automation;
  const unlocked = state.permanent.skillRanks.automation > 0;
  const reorder = (index: number, id: EquipmentId) => {
    const priority = [...settings.priority];
    const other = priority.indexOf(id);
    [priority[index], priority[other]] = [priority[other]!, priority[index]!];
    onChange({ ...settings, priority });
  };
  return <details className="automation-panel">
    <summary>自動購入: {settings.enabled ? 'ON' : 'OFF'} <span>{AUTOMATION_POLICIES[settings.policy]}</span></summary>
    <div className="automation-content">
      <p>{unlocked ? '表示中も放置中（最大24時間）も同じ方針で購入します。設定は転生後も引き継ぎます。' : '「自動設備管理」（豊かな収穫ランク1・転生1回以上・1pt）で解禁します。初期設定はOFFです。'}</p>
      {isPaused && <p>セーブの確認が必要なため設定変更を停止しています。</p>}
      <fieldset disabled={!unlocked || isPaused}>
        <legend>自動購入設定</legend>
        <label className="automation-toggle"><input type="checkbox" checked={settings.enabled} onChange={(e) => onChange({ ...settings, enabled: e.currentTarget.checked })} />自動購入を有効にする</label>
        <label className="automation-policy">購入方針<select value={settings.policy} onChange={(e) => onChange({ ...settings, policy: e.currentTarget.value as AutomationPolicy })}>
          {Object.entries(AUTOMATION_POLICIES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <p className="shop-note">{settings.policy === 'balanced' ? '所有台数が最少の設備を次の目標にして貯めます。同数は設備の掲載順です。' : settings.policy === 'efficient' ? '次の1台の価格÷実際の生産増分が最小の設備を目標にして貯めます。台数ボーナスも含みます。' : '買える設備から上の優先順で購入します。買えなければ次へ進み、資金は保留しません。'}</p>
        <div className="automation-equipment">
          {EQUIPMENT_IDS.map((id) => <div key={id}>
            <label className="automation-toggle"><input type="checkbox" checked={settings.equipment[id]} onChange={(e) => onChange({ ...settings, equipment: { ...settings.equipment, [id]: e.currentTarget.checked } })} />{EQUIPMENT[id].name}の自動購入</label>
            {!getEquipmentAvailability(id, state).unlocked && <p className="shop-note">上限1E9で解禁。現在は購入対象から除外します。</p>}
          </div>)}
        </div>
        {settings.policy === 'priority' && <div className="automation-priority">
          <p>指定優先順（変更すると選んだ設備と入れ替えます）</p>
          {settings.priority.map((id, index) => <label key={index}>第{index + 1}優先の設備<select value={id} onChange={(e) => reorder(index, e.currentTarget.value as EquipmentId)}>
            {EQUIPMENT_IDS.map((equipmentId) => <option key={equipmentId} value={equipmentId}>{EQUIPMENT[equipmentId].name}</option>)}
          </select></label>)}
        </div>}
      </fieldset>
      <p>現在の方針: {AUTOMATION_POLICIES[settings.policy]} / 自動購入 {settings.enabled ? 'ON' : 'OFF'}</p>
      <p aria-live="off">直近の自動購入: <output aria-label="直近の自動購入台数">{automaticPurchases}</output> 台</p>
      <p className="shop-note">全体がOFFなら購入しません。設備別設定は初期ONです。上限で停止し、転生・限界突破は手動で行います。手動購入も使えます。</p>
    </div>
  </details>;
}
