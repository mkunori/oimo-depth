import { gn } from '../core/numbers';

export const ROOT_REWARDS = [{ score: gn(1e18), crystals: 1 }] as const;
export const ROOT_PRODUCTION_PER_REBIRTH = 2;
export const ROOT_FIRST_PRODUCTION_MULTIPLIER = 1 + ROOT_PRODUCTION_PER_REBIRTH;
export const ROOT_UPGRADE_IDS = ['blessing', 'memory', 'adaptation'] as const;
export type RootUpgradeId = typeof ROOT_UPGRADE_IDS[number];
export type RootUpgradeRanks = Readonly<Record<RootUpgradeId, number>>;
interface RootUpgrade {
  readonly name: string;
  readonly costs: readonly number[];
  readonly prerequisites: readonly { readonly id: RootUpgradeId; readonly rank: number }[];
  readonly effect: { readonly type: 'production' | 'startingImo' | 'lateAndDig'; readonly values: readonly number[]; readonly priceMultipliers?: readonly number[] };
  readonly description: string;
}
export const ROOT_UPGRADES = {
  blessing: { name: '原初の恵み', costs: [1, 2, 3], prerequisites: [],
    effect: { type: 'production', values: [1, 1.5, 2.25, 3.375] },
    description: '全収穫を1.5倍ずつ強化します。購入直後から適用します。' },
  memory: { name: '根源の記憶', costs: [1, 2, 3], prerequisites: [],
    effect: { type: 'startingImo', values: [0, 100, 250, 500], priceMultipliers: [1, 0.9, 0.85, 0.8] },
    description: '設備価格を直ちに10 / 15 / 20%割引。次の通常転生・ROOTから初期所持芋を100 / 250 / 500芋追加します。購入時の即時支給やSCORE加算はありません。' },
  adaptation: { name: '地底への適応', costs: [1, 2, 3], prerequisites: [{ id: 'blessing', rank: 1 }],
    effect: { type: 'lateAndDig', values: [1, 1.5, 2.25, 3.375] },
    description: '地脈抽出機以降の設備収穫と掘削力を1.5倍ずつ強化します。リンク追加収穫は対象外です。' },
} as const satisfies Record<RootUpgradeId, RootUpgrade>;
export function createEmptyRootUpgrades(): RootUpgradeRanks { return { blessing: 0, memory: 0, adaptation: 0 }; }

export function createInitialRootProgress() {
  return { rootRebirthCount: 0, unspentRootCrystals: 0, totalRootCrystalsEarned: 0, totalRootCrystalsSpent: 0,
    rootUpgradeRanks: createEmptyRootUpgrades(), equipmentSystemUnlocked: false };
}
