import type { GearId } from '../data/gear';

export function GearIcon({ id }: { readonly id: GearId }) {
  return <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {id === 'shovel' && <path d="M20 4h8v7h-8zM24 11v20M16 28h16v7q-2 8-8 10-6-2-8-10zM20 35h8" />}
    {id === 'lens' && <><circle cx="21" cy="20" r="13" /><circle cx="21" cy="20" r="8" /><path d="M31 30l11 11M15 16l6-3M5 4l3 4M38 5l-4 4" /></>}
    {id === 'drillBit' && <path d="M18 4h12v10H18zM16 14h16l-4 25-4 6-4-6zM18 20l12 6M17 27l12 6M21 5v8M27 5v8" />}
    {id === 'compass' && <><circle cx="24" cy="25" r="17" /><circle cx="24" cy="5" r="3" /><path d="M31 16l-4 13-10 5 4-13zM24 8v4M24 38v4M7 25h4M37 25h4" /></>}
    {id === 'rootCore' && <><path d="M24 4l14 9v20l-14 11-14-11V13zM24 12l8 13-8 11-8-11zM24 4v8M10 13l6 12M38 13l-6 12M24 36v8" /><circle cx="24" cy="25" r="3" /></>}
  </svg>;
}
