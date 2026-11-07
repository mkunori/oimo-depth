import { useRef, useState } from 'react';
import type { GameState } from '../../core/state';
import { GEAR, GEAR_IDS } from '../../data/gear';
import type { GearId } from '../../data/gear';
import { EQUIPMENT_GROUPS, GEAR_MODES, GEAR_PRESETS } from '../../data/gearModes';
import type { GearModeId, GearPresetId } from '../../data/gearModes';
import { getModeDefinition } from '../../core/gearModeEffects';
import { applyGearPreset, previewGearChange, setGearMode } from '../../core/gearModes';

export interface GearControlProps {
  readonly onMode?: (id: GearId, mode: GearModeId) => boolean;
  readonly onPreset?: (id: GearPresetId) => boolean;
  readonly onEditPreset?: (slot: number, operation: 'save' | 'rename' | 'delete', name?: string) => boolean;
  readonly notice?: string | null;
}
export function GearModeControls({ state, isPaused, onMode, onPreset, onEditPreset, notice }: GearControlProps & { state: GameState; isPaused: boolean }) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<null | { gear: GearId; mode: GearModeId } | { preset: GearPresetId }>(null);
  const p = state.permanent, owned = GEAR_IDS.filter((id) => p.gearUnlocked[id]);
  if (!owned.length) return null;
  const selected = p.selectedGearPreset;
  const current = selected === 'custom' ? 'カスタム' : selected.startsWith('custom-')
    ? p.gearCustomPresets[Number(selected.slice(-1)) - 1]!.name : GEAR_PRESETS[selected as keyof typeof GEAR_PRESETS].name;
  const preview = pending ? previewGearChange(state, (s) => 'gear' in pending ? setGearMode(s, pending.gear, pending.mode) : applyGearPreset(s, pending.preset)) : null;
  const edit = (slot: number, operation: 'save' | 'rename' | 'delete') => {
    const name = inputs.current[slot]?.value.trim() ?? '';
    const duplicate = Object.values(GEAR_PRESETS).some((v) => v.name === name)
      || p.gearCustomPresets.some((v, index) => index !== slot && v?.name === name);
    if (operation !== 'delete' && (!name || name.length > 20 || /[\x00-\x1f\x7f]/.test(name) || duplicate)) {
      setError('名前は重複しない1〜20文字で入力してください。'); return;
    }
    setError(''); onEditPreset?.(slot, operation, name);
  };
  return <details className="gear-mode-controls"><summary>効果モード・プリセット — 現在: {current}</summary>
    <p>全装備の常時効果＋各装備1モード。無料で即時切替できます。切替までの時間は旧構成で精算します。新しい装備は標準モードで解禁されます。</p>
    <div className="gear-preset-buttons">{Object.entries(GEAR_PRESETS).map(([id, preset]) => {
      const rates = previewGearChange(state, (s) => applyGearPreset(s, id as GearPresetId));
      return <div key={id}><button className="secondary-button" disabled={isPaused} onClick={() => { if (onPreset?.(id as GearPresetId)) setPending(null); }}>{preset.name}に切替</button>
        <p>{owned.map((gear) => `${GEAR[gear].name}: ${getModeDefinition(gear, preset.modes[gear]).name}`).join(' / ')}</p>
        <p>収穫 {rates.before.production.format()} → {rates.after.production.format()} 芋/s、掘削 {rates.before.dig.toPrecision(4)} → {rates.after.dig.toPrecision(4)} m/s</p></div>;
    })}</div>
    <label>目的別プリセット<select value={pending && 'preset' in pending ? pending.preset : selected} disabled={isPaused} onChange={(e) => setPending({ preset: e.target.value as GearPresetId })}>
      <option value="custom" disabled>カスタム</option>
      {Object.entries(GEAR_PRESETS).map(([id, v]) => <option key={id} value={id}>{v.name}</option>)}
      {p.gearCustomPresets.map((slot, index) => slot && <option key={index} value={`custom-${index + 1}`}>{slot.name}</option>)}
    </select></label>
    {owned.map((id) => {
      const mode = getModeDefinition(id, p.gearModes[id]);
      return <div key={id} className="gear-mode-row"><label>{GEAR[id].name}のモード<select disabled={isPaused} value={pending && 'gear' in pending && pending.gear === id ? pending.mode : p.gearModes[id]} onChange={(e) => setPending({ gear: id, mode: e.target.value as GearModeId })}>
        {Object.entries(GEAR_MODES[id]).map(([key, v]) => <option key={key} value={key}>{v.name} — {v.description}</option>)}
      </select></label><p>現在: {mode.name} — {mode.description}</p>
      {mode.needsGeology && state.researchRanks.geology === 0 && <p>現在は未発動: 地質研究1が必要です。</p>}
      {mode.group && <p>{EQUIPMENT_GROUPS[mode.group].some((equipment) => state.equipmentCounts[equipment] > 0) ? '対象の所有設備に適用中。' : '現在は未発動: 対象設備を未所有です。'}</p>}
      {mode.link && <p>{state.equipmentCounts.rootRelay >= 2 && state.equipmentCounts.coreChamber >= 1 ? 'リンク追加生産に適用中。' : '現在はリンク効果未発動: 設備のリンク成立が必要です。'}</p>}
      </div>;
    })}
    {preview && <div className="gear-preview"><p>切替前 → 切替後: 収穫 {preview.before.production.format()} → {preview.after.production.format()} 芋/s、掘削 {preview.before.dig.toPrecision(4)} → {preview.after.dig.toPrecision(4)} m/s、実効硬度 {preview.before.hardness} → {preview.after.hardness}</p>
      <button disabled={isPaused} onClick={() => { if (!pending) return; const ok = 'gear' in pending ? onMode?.(pending.gear, pending.mode) : onPreset?.(pending.preset); if (ok) setPending(null); }}>この構成を適用</button>
      <button className="secondary-button" onClick={() => setPending(null)}>キャンセル</button></div>}
    {notice?.startsWith('装備構成を保存しました。') && <p role="status">{notice}</p>}
    <details><summary>カスタムプリセット（3枠）</summary><p>現在の所有装備だけを保存します。同じ枠への保存は上書きです。名前変更は構成を保持し、削除後も現在の効果は保持します。</p>
      {p.gearCustomPresets.map((slot, index) => <div key={index} className="gear-custom-slot"><label>枠{index + 1}の名前<input key={slot?.name ?? 'empty'} ref={(node) => { inputs.current[index] = node; }} defaultValue={slot?.name ?? ''} maxLength={20} disabled={isPaused} /></label>
        <button disabled={isPaused} onClick={() => edit(index, 'save')}>{slot ? '現在の構成で上書き' : '現在の構成を保存'}</button>
        {slot && <><button disabled={isPaused} onClick={() => { setPending({ preset: `custom-${index + 1}` as GearPresetId }); }}>適用を確認</button><button disabled={isPaused} onClick={() => edit(index, 'rename')}>名前変更</button><button disabled={isPaused} onClick={() => edit(index, 'delete')}>削除</button></>}
      </div>)}{error && <p role="alert">{error}</p>}
    </details>
  </details>;
}
