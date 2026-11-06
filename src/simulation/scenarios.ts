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
  { feature: '既存設備・台数倍率・自動採掘・SCOREクリップ', status: 'core', detail: '実際のゲーム計算関数を使用。追加2設備は初期上限でロック' },
  { feature: '1〜6回の通常転生・3種の基本スキル', status: 'core', detail: '実際のポイントと前提に従って購入' },
  { feature: '復帰・24時間上限・セーブ復元', status: 'core', detail: '各復帰で保存形式を往復し settleOffline を実行' },
  { feature: '1e9 / 1e12 / 1e15', status: 'projection', detail: '固定生産力での必要時間・目標時間に必要な生産量のみ試算' },
  { feature: '初回突破・上位設備を含む1e9帯', status: 'core', detail: '権利取得から同一周回の突破、設備購入、v6保存・復元まで実コアで検証' },
  { feature: '自動設備管理・3購入方針・オンライン/放置', status: 'core', detail: '取得コストを含む12経路と、同じ取得済み状態からの24比較。購入イベントと実際の上限到達を記録' },
  { feature: '掘削・地層・自動転生・自動突破', status: 'not-modeled', detail: '自動化は設備購入のみ。従来の常時操作15方策は手動操作の理想化比較として保持' },
  { feature: '第2限界突破・地層研究', status: 'modeled', detail: '正規の1e9到達→無料深層解析→1e12、新設備2種と手動研究2種、1分/6h/12h・手動/自動の18比較' },
  { feature: '1e12より先の限界突破', status: 'not-modeled', detail: '上位転生・1e15以上は未実装' },
  { feature: '上位転生・装備モード・消費可能SCORE', status: 'not-modeled', detail: '#7/#8 の閾値・費用・倍率が未確定。仕様とコアの追加後に到達時間・構成差を検証する' },
  { feature: 'クリック補助・任意ブースト', status: 'not-modeled', detail: '機能・数値とも未実装' },
] as const;
