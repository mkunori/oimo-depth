export interface EquipmentDefinition {
  readonly name: string;
  readonly basePrice: number;
  readonly priceMultiplier: number;
  readonly productionPerUnit: number;
}

export const EQUIPMENT = Object.freeze({
  worker: Object.freeze({
    name: '作業員',
    basePrice: 10,
    priceMultiplier: 1.15,
    productionPerUnit: 1,
  }),
  cart: Object.freeze({
    name: '運搬車',
    basePrice: 100,
    priceMultiplier: 1.2,
    productionPerUnit: 10,
  }),
  harvester: Object.freeze({
    name: '自動収穫機',
    basePrice: 1_000,
    priceMultiplier: 1.25,
    productionPerUnit: 100,
  }),
} satisfies Record<string, EquipmentDefinition>);

export type EquipmentId = keyof typeof EQUIPMENT;

export const EQUIPMENT_IDS: readonly EquipmentId[] = Object.freeze(
  Object.keys(EQUIPMENT) as EquipmentId[],
);
