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
      {id === 'deepDrill' && <>
        <path d="M9 39h30M14 39V18l10-11 10 11v21M19 21h10M20 25h8l-8 5h8l-8 5h8M24 7V3M10 18h28" />
      </>}
      {id === 'refinery' && <>
        <path d="M6 40V20h15v20M27 40V13h15v27M3 40h42M11 20V7h5v13M27 24h-6M34 13V4h5v9M10 27h7M10 33h7M31 21h7M31 28h7M31 35h7" />
      </>}
      {id === 'veinExtractor' && <>
        <path d="M5 40h38M12 40V17l12-9 12 9v23M18 17h12v12H18zM24 29v11M5 28l7 5M36 33l7-5M20 4h8" />
      </>}
      {id === 'concentrator' && <>
        <path d="M10 40h28M14 40V22L9 10h30l-5 12v18M14 22h20M20 27l-3 6 7 4 7-4-3-6M24 10V4M19 4h10" />
      </>}
      {id === 'rootRelay' && <>
        <path d="M10 41h28M16 41l5-28h6l5 28M18 29h12M20 21h8M24 13V5M15 9l-6 6M33 9l6 6M12 24l-7 5M36 24l7 5" />
        <circle cx="24" cy="9" r="3" />
      </>}
      {id === 'coreChamber' && <>
        <path d="M13 9h22M15 9v29q9 7 18 0V9M11 41h26M12 4h24v5H12zM15 20h18M15 33h18M24 20v-5" />
        <ellipse cx="24" cy="27" rx="5" ry="7" />
      </>}
      {id === 'originMiner' && <>
        <path d="M6 40h36M11 40V16l13-9 13 9v24M17 18h14M24 18v18M19 25l10 5-10 6M6 25l5 6M37 31l5-6" />
        <circle cx="24" cy="7" r="3" />
      </>}
      {id === 'imoReactor' && <>
        <path d="M9 40h30M14 40V13h20v27M10 13h28M18 13V6h12v7M14 32h20M19 40v4M29 40v4" />
        <path d="M24 17l-6 9 6 4 6-4zM4 20l4 4-4 4M44 20l-4 4 4 4" />
      </>}
    </svg>
  );
}
