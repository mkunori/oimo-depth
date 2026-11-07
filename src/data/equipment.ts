import { GameNumber, gn } from '../core/numbers';
export interface EquipmentMilestone {
  readonly count: number;
  readonly multiplier: number;
}

export interface EquipmentDefinition {
  readonly name: string;
  readonly basePrice: GameNumber;
  readonly priceMultiplier: GameNumber;
  readonly productionPerUnit: GameNumber;
  readonly digPowerPerUnit: number;
  readonly unlockAtScoreCap: GameNumber;
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
    digPowerPerUnit: 0.005,
    name: '作業員',
    basePrice: gn(10),
    priceMultiplier: gn(1.15),
    productionPerUnit: gn(1),
    unlockAtScoreCap: gn(1_000_000),
    milestones: EQUIPMENT_MILESTONES,
  }),
  cart: Object.freeze({
    digPowerPerUnit: 0.00125,
    name: '運搬車',
    basePrice: gn(100),
    priceMultiplier: gn(1.2),
    productionPerUnit: gn(10),
    unlockAtScoreCap: gn(1_000_000),
    milestones: EQUIPMENT_MILESTONES,
  }),
  harvester: Object.freeze({
    digPowerPerUnit: 0.0025,
    name: '自動収穫機',
    basePrice: gn(1_000),
    priceMultiplier: gn(1.25),
    productionPerUnit: gn(100),
    unlockAtScoreCap: gn(1_000_000),
    milestones: EQUIPMENT_MILESTONES,
  }),
  deepDrill: Object.freeze({
    digPowerPerUnit: 0.5,
    name: '深層掘削機', basePrice: gn(2_000_000), priceMultiplier: gn(1.2), productionPerUnit: gn(1_500),
    unlockAtScoreCap: gn(1_000_000_000), milestones: [],
  }),
  refinery: Object.freeze({
    digPowerPerUnit: 0.005,
    name: '芋精製プラント', basePrice: gn(20_000_000), priceMultiplier: gn(1.22), productionPerUnit: gn(15_000),
    unlockAtScoreCap: gn(1_000_000_000), milestones: [],
  }),
  veinExtractor: Object.freeze({
    digPowerPerUnit: 1.5,
    name: '地脈抽出機', basePrice: gn(100_000_000), priceMultiplier: gn(1.2), productionPerUnit: gn(500_000),
    unlockAtScoreCap: gn(1_000_000_000_000), milestones: EQUIPMENT_MILESTONES,
  }),
  concentrator: Object.freeze({
    digPowerPerUnit: 0.0075,
    name: '芋濃縮炉', basePrice: gn(1_000_000_000), priceMultiplier: gn(1.25), productionPerUnit: gn(8_000_000),
    unlockAtScoreCap: gn(1_000_000_000_000), milestones: [],
  }),
  rootRelay: Object.freeze({
    digPowerPerUnit: 2.5,
    name: '根脈中継塔', basePrice: gn(2e13), priceMultiplier: gn(1.25), productionPerUnit: gn(5e8),
    unlockAtScoreCap: gn(1e15), milestones: [],
  }),
  coreChamber: Object.freeze({
    digPowerPerUnit: 0.025,
    name: '芋核培養槽', basePrice: gn(2e14), priceMultiplier: gn(1.3), productionPerUnit: gn(5e9),
    unlockAtScoreCap: gn(1e15), milestones: [],
  }),
} satisfies Record<string, EquipmentDefinition>);

export type EquipmentId = keyof typeof EQUIPMENT;
export const ROOT_EQUIPMENT_IDS = ['rootRelay', 'coreChamber'] as const;
export const ROOT_LINK_PRODUCTION = gn(5e9);
export function isRootEquipment(id: EquipmentId): boolean { return (ROOT_EQUIPMENT_IDS as readonly EquipmentId[]).includes(id); }

export const EQUIPMENT_IDS: readonly EquipmentId[] = Object.freeze(
  Object.keys(EQUIPMENT) as EquipmentId[],
);

export function createEmptyEquipmentCounts(): Record<EquipmentId, number> {
  return Object.fromEntries(EQUIPMENT_IDS.map((id) => [id, 0])) as Record<EquipmentId, number>;
}
