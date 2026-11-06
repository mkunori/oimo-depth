import { configureAutomation, getEquipmentAvailability, getEquipmentPrice, getEquipmentPurchaseGain, purchaseEquipment } from '../core/game';
import type { AutomationPolicy } from '../data/automation';
import { purchaseSkill } from '../core/prestige';
import type { GameState } from '../core/state';
import { EQUIPMENT_IDS } from '../data/equipment';
import type { EquipmentId } from '../data/equipment';
import type { SkillId } from '../data/skills';

export type EquipmentPolicy = 'none' | 'payback' | 'highest-tier';
export const SKILL_PLANS = {
  harvest: ['harvest', 'harvest', 'harvest', 'discount', 'discount', 'startingImo', 'startingImo'],
  discount: ['harvest', 'discount', 'discount', 'harvest', 'harvest', 'startingImo', 'startingImo'],
  startingImo: ['harvest', 'startingImo', 'startingImo', 'harvest', 'harvest', 'discount', 'discount'],
  save: [],
  breakthrough: ['harvest', 'harvest', 'harvest', 'discount', 'breakthrough'],
  'late-breakthrough': ['harvest', 'harvest', 'harvest', 'discount', 'discount', 'startingImo', 'startingImo', 'breakthrough'],
  'automation-first': ['harvest', 'automation', 'harvest', 'harvest', 'discount', 'breakthrough'],
} as const satisfies Record<string, readonly SkillId[]>;
export type SkillPlan = keyof typeof SKILL_PLANS;

/** 指定順の次ランクを買えなければ貯める。安い下位候補へ勝手に振り替えない。 */
export function investSkills(state: GameState, plan: SkillPlan, automation?: AutomationPolicy): GameState {
  const targetRanks = { automation: 0, harvest: 0, discount: 0, startingImo: 0, breakthrough: 0 };
  for (const id of SKILL_PLANS[plan]) {
    targetRanks[id] += 1;
    if (state.permanent.skillRanks[id] >= targetRanks[id]) continue;
    const next = purchaseSkill(state, id);
    if (next === state) break;
    state = next;
  }
  return automation && state.permanent.skillRanks.automation > 0
    ? configureAutomation(state, { ...state.automation, enabled: true, policy: automation }) : state;
}

function payback(state: GameState, id: EquipmentId): number {
  return getEquipmentPrice(id, state.equipmentCounts[id], state.permanent)
    / getEquipmentPurchaseGain(id, state.equipmentCounts[id], state.permanent, state.researchRanks);
}

/** 現在買える設備だけで選ぶ局所方策。将来を見通した最適化ではない。 */
export function investEquipment(state: GameState, policy: EquipmentPolicy, allowed: readonly EquipmentId[] = EQUIPMENT_IDS) {
  if (policy === 'none') return { state, purchased: 0 };
  let purchased = 0;
  while (true) {
    const affordable = allowed.filter((id) => getEquipmentAvailability(id, state).unlocked && getEquipmentPrice(id, state.equipmentCounts[id], state.permanent) <= state.imo);
    const id = policy === 'highest-tier' ? affordable.at(-1)
      : affordable.sort((left, right) => payback(state, left) - payback(state, right))[0];
    if (id === undefined) return { state, purchased };
    const next = purchaseEquipment(state, id, 1);
    if (next === state) return { state, purchased };
    state = next;
    purchased += 1;
  }
}
