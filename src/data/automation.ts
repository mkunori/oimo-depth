import { EQUIPMENT_IDS } from './equipment';
import type { EquipmentId } from './equipment';

export const AUTOMATION_POLICIES = {
  balanced: '均等', efficient: '収穫効率優先', priority: '指定設備優先',
} as const;
export type AutomationPolicy = keyof typeof AUTOMATION_POLICIES;
export interface AutomationSettings {
  readonly enabled: boolean;
  readonly policy: AutomationPolicy;
  readonly equipment: Readonly<Record<EquipmentId, boolean>>;
  readonly priority: readonly EquipmentId[];
}

export function createDefaultAutomation(): AutomationSettings {
  return { enabled: false, policy: 'efficient',
    equipment: Object.fromEntries(EQUIPMENT_IDS.map((id) => [id, true])) as Record<EquipmentId, boolean>,
    priority: [...EQUIPMENT_IDS] };
}

/** 外部入力も検証する。優先順は全設備IDの重複のない順列のみ許可する。 */
export function readAutomation(value: unknown): AutomationSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new RangeError('Invalid automation settings.');
  const settings = value as Record<string, unknown>;
  if (typeof settings.enabled !== 'boolean' || typeof settings.policy !== 'string' || !Object.hasOwn(AUTOMATION_POLICIES, settings.policy)
    || typeof settings.equipment !== 'object' || settings.equipment === null || Array.isArray(settings.equipment)
    || !Array.isArray(settings.priority) || settings.priority.length !== EQUIPMENT_IDS.length
    || new Set(settings.priority).size !== EQUIPMENT_IDS.length || settings.priority.some((id) => !EQUIPMENT_IDS.includes(id))) {
    throw new RangeError('Invalid automation settings.');
  }
  const equipment = settings.equipment as Record<string, unknown>;
  if (Object.keys(equipment).length !== EQUIPMENT_IDS.length || EQUIPMENT_IDS.some((id) => typeof equipment[id] !== 'boolean')) throw new RangeError('Invalid automated equipment selection.');
  return { enabled: settings.enabled, policy: settings.policy as AutomationPolicy,
    equipment: Object.fromEntries(EQUIPMENT_IDS.map((id) => [id, equipment[id]])) as Record<EquipmentId, boolean>,
    priority: [...settings.priority] as EquipmentId[] };
}
