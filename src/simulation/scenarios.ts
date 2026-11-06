import type { Scenario } from './simulator';

export const SCENARIOS: readonly Scenario[] = [
  { id: 'idle-cap', label: '購入なし・ポイント温存', visitSeconds: null, presence: 'online', equipment: 'none', skillPlan: 'save', prestigeAt: 'cap' },
  { id: 'continuous-cap', label: '常時操作・上限転生・収穫優先', visitSeconds: null, presence: 'online', equipment: 'payback', skillPlan: 'harvest', prestigeAt: 'cap' },
  { id: 'active-60-cap', label: '1分確認・上限転生・収穫優先', visitSeconds: 60, presence: 'online', equipment: 'payback', skillPlan: 'harvest', prestigeAt: 'cap' },
  { id: 'active-300-cap', label: '5分確認・上限転生・収穫優先', visitSeconds: 300, presence: 'online', equipment: 'payback', skillPlan: 'harvest', prestigeAt: 'cap' },
  { id: 'active-900-cap', label: '15分確認・上限転生・収穫優先', visitSeconds: 900, presence: 'online', equipment: 'payback', skillPlan: 'harvest', prestigeAt: 'cap' },
  { id: 'offline-6h-cap', label: '1日4回復帰・上限転生', visitSeconds: 21_600, presence: 'offline', equipment: 'payback', skillPlan: 'harvest', prestigeAt: 'cap' },
  { id: 'offline-12h-cap', label: '1日2回復帰・上限転生', visitSeconds: 43_200, presence: 'offline', equipment: 'payback', skillPlan: 'harvest', prestigeAt: 'cap' },
  { id: 'offline-48h-cap', label: '48時間ごと復帰・24時間制限', visitSeconds: 172_800, presence: 'offline', equipment: 'payback', skillPlan: 'harvest', prestigeAt: 'cap' },
  { id: 'continuous-early', label: '常時操作・早期転生・収穫優先', visitSeconds: null, presence: 'online', equipment: 'payback', skillPlan: 'harvest', prestigeAt: 'early' },
  { id: 'active-60-early', label: '1分確認・早期転生・収穫優先', visitSeconds: 60, presence: 'online', equipment: 'payback', skillPlan: 'harvest', prestigeAt: 'early' },
  { id: 'offline-6h-early', label: '1日4回復帰・早期転生方針', visitSeconds: 21_600, presence: 'offline', equipment: 'payback', skillPlan: 'harvest', prestigeAt: 'early' },
  { id: 'active-60-discount', label: '1分確認・上限転生・割引優先', visitSeconds: 60, presence: 'online', equipment: 'payback', skillPlan: 'discount', prestigeAt: 'cap' },
  { id: 'active-60-starting', label: '1分確認・上限転生・初期所持芋優先', visitSeconds: 60, presence: 'online', equipment: 'payback', skillPlan: 'startingImo', prestigeAt: 'cap' },
  { id: 'active-60-save', label: '1分確認・上限転生・ポイント温存', visitSeconds: 60, presence: 'online', equipment: 'payback', skillPlan: 'save', prestigeAt: 'cap' },
  { id: 'active-60-tier', label: '1分確認・上位設備優先', visitSeconds: 60, presence: 'online', equipment: 'highest-tier', skillPlan: 'harvest', prestigeAt: 'cap' },
];

/** 未実装の挙動を現行実測へ混ぜない。後続の仕様確定後にシナリオへ追加する。 */
export const COVERAGE = [
  { feature: '通常設備・自動採掘・SCOREクリップ', status: 'core', detail: '実際のゲーム計算関数を使用' },
  { feature: '1〜6回の通常転生・3種の基本スキル', status: 'core', detail: '実際のポイントと前提に従って購入' },
  { feature: '復帰・24時間上限・セーブ復元', status: 'core', detail: '各復帰で保存形式を往復し settleOffline を実行' },
  { feature: '1e9 / 1e12 / 1e15', status: 'projection', detail: '固定生産力での必要時間・目標時間に必要な生産量のみ試算' },
  { feature: '掘削・設備自動購入スキル・地層', status: 'not-modeled', detail: '計算式・効果未確定。常時操作は自動購入機能ではなく理想化した操作方策' },
  { feature: '限界突破の条件・費用・保持範囲', status: 'not-modeled', detail: '現行の上限は1e6。条件確定後に非リセット遷移を追加する' },
  { feature: '上位転生・装備モード・消費可能SCORE', status: 'not-modeled', detail: '#7/#8 の閾値・費用・倍率が未確定。仕様とコアの追加後に到達時間・構成差を検証する' },
  { feature: 'クリック補助・任意ブースト', status: 'not-modeled', detail: '機能・数値とも未実装' },
] as const;
