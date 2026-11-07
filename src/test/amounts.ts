import { GameNumber, gn } from '../core/numbers';
import type { GameNumberInput } from '../core/numbers';
import { SAVE_VERSION } from '../core/save';

/** Invalid numeric fixtures must reach the production validator, rather than fail during test collection. */
export function testAmount(value: GameNumberInput): GameNumber {
  return typeof value === 'number' && !Number.isFinite(value) ? value as unknown as GameNumber : gn(value);
}

/** Construct authentic external JSON for each save version; never relax the production parser. */
export function stringifyTestSave(value: unknown): string {
  const version = (value as { saveVersion?: number } | null)?.saveVersion ?? SAVE_VERSION;
  const convert = (item: unknown): unknown => {
    if (item instanceof GameNumber) return version < 7 ? item.toFiniteNumber() : item.toString();
    if (Array.isArray(item)) return item.map(convert);
    if (item !== null && typeof item === 'object') {
      const object = { ...item } as Record<string, unknown>;
      if (version < 9 && 'policy' in object && 'priority' in object && object.equipment && typeof object.equipment === 'object') {
        const equipment = { ...object.equipment } as Record<string, unknown>;
        delete equipment.rootRelay; delete equipment.coreChamber; object.equipment = equipment;
        if (Array.isArray(object.priority)) object.priority = object.priority.filter((id) => id !== 'rootRelay' && id !== 'coreChamber');
      }
      if (version < 7 && 'productionRemainder' in object) {
        if (object.automationRemainder === undefined && version >= 5) object.automationRemainder = object.productionRemainder;
        delete object.productionRemainder;
      }
      return Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, convert(entry)]));
    }
    return item;
  };
  return JSON.stringify(convert(value));
}
