import type { PermanentProgress } from './state';

/** One permission boundary for normal unlocks and permanent ROOT automation. */
export function hasAutomationAccess(p: PermanentProgress): boolean {
  return p.skillRanks.automation > 0 || p.rootAutomationUnlocked;
}
