import type { EquipmentId } from '../data/equipment';

export function EquipmentIcon({ id }: { readonly id: EquipmentId }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {id === 'worker' && <>
        <circle cx="21" cy="12" r="5" />
        <path d="M12 31v-8a7 7 0 0 1 14 0v8M17 41V29h9v12M11 19l-5 8M27 24l9-6M34 11l6 28M30 40h14" />
      </>}
      {id === 'cart' && <>
        <path d="M8 16h30l-4 16H14L6 10H2M16 21l2 7M24 21v7M32 21l-2 7" />
        <circle cx="17" cy="38" r="4" />
        <circle cx="33" cy="38" r="4" />
      </>}
      {id === 'harvester' && <>
        <path d="M6 31V18h20v13M26 31V12h11l5 9v10M29 16h6l3 6h-9M11 18v-6h9v6M4 31h40M13 23h7" />
        <circle cx="14" cy="36" r="6" />
        <circle cx="35" cy="36" r="5" />
      </>}
    </svg>
  );
}
