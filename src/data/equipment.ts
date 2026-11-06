export interface EquipmentMilestone {
  readonly count: number;
  readonly multiplier: number;
}

export interface EquipmentDefinition {
  readonly name: string;
  readonly basePrice: number;
  readonly priceMultiplier: number;
  readonly productionPerUnit: number;
  readonly unlockAtScoreCap: number;
  readonly milestones: readonly EquipmentMilestone[];
}

export const INITIAL_EQUIPMENT_IDS = ['worker', 'cart', 'harvester'] as const;
export const EQUIPMENT_MILESTONES: readonly EquipmentMilestone[] = Object.freeze([
  Object.freeze({ count: 10, multiplier: 1.1 }),
  Object.freeze({ count: 25, multiplier: 1.15 }),
  Object.freeze({ count: 50, multiplier: 1.25 }),
]);

export const EQUIPMENT = Object.freeze({
  worker: Object.freeze({
    name: '作業員',
    basePrice: 10,
    priceMultiplier: 1.15,
    productionPerUnit: 1,
    unlockAtScoreCap: 1_000_000,
    milestones: EQUIPMENT_MILESTONES,
  }),
  cart: Object.freeze({
    name: '運搬車',
    basePrice: 100,
    priceMultiplier: 1.2,
    productionPerUnit: 10,
    unlockAtScoreCap: 1_000_000,
    milestones: EQUIPMENT_MILESTONES,
  }),
  harvester: Object.freeze({
    name: '自動収穫機',
    basePrice: 1_000,
    priceMultiplier: 1.25,
    productionPerUnit: 100,
    unlockAtScoreCap: 1_000_000,
    milestones: EQUIPMENT_MILESTONES,
  }),
  deepDrill: Object.freeze({
    name: '深層掘削機', basePrice: 2_000_000, priceMultiplier: 1.2, productionPerUnit: 1_500,
    unlockAtScoreCap: 1_000_000_000, milestones: [],
  }),
  refinery: Object.freeze({
    name: '芋精製プラント', basePrice: 20_000_000, priceMultiplier: 1.22, productionPerUnit: 15_000,
    unlockAtScoreCap: 1_000_000_000, milestones: [],
  }),
} satisfies Record<string, EquipmentDefinition>);

export type EquipmentId = keyof typeof EQUIPMENT;

export const EQUIPMENT_IDS: readonly EquipmentId[] = Object.freeze(
  Object.keys(EQUIPMENT) as EquipmentId[],
);

export function createEmptyEquipmentCounts(): Record<EquipmentId, number> {
  return Object.fromEntries(EQUIPMENT_IDS.map((id) => [id, 0])) as Record<EquipmentId, number>;
}
