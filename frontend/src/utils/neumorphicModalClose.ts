/**
 * Shared Tailwind class strings for neumorphic-style modal close (X) buttons.
 * Matches soft-UI palette used elsewhere (#e8ecf3 / dual shadow).
 */

export const NEUMORPH_MODAL_CLOSE_LG =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-400/25 bg-[#e8ecf3] text-slate-600 shadow-[6px_6px_12px_#b8bec7,-6px_-6px_12px_#ffffff] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[8px_8px_16px_#b8bec7,-8px_-8px_16px_#ffffff] active:translate-y-0 active:shadow-[inset_4px_4px_8px_#b8bec7,inset_-4px_-4px_8px_#ffffff] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50';

export const NEUMORPH_MODAL_CLOSE_ON_DARK =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white shadow-[0_4px_14px_rgba(0,0,0,0.3)] backdrop-blur-sm transition hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/45';

export const NEUMORPH_MODAL_CLOSE_ICON = 'h-6 w-6 pointer-events-none';

export const NEUMORPH_MODAL_CLOSE_ICON_ON_DARK = 'h-6 w-6 pointer-events-none text-white';

export const NEUMORPH_MODAL_CLOSE_STROKE_W = 2;
