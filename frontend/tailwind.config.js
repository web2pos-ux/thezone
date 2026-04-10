/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  /** softNeumorphic NEO_MODAL_BTN_PRESS 등 문자열 상수로만 쓰는 active 유틸이 빌드에서 빠지지 않도록 */
  safelist: [
    '[webkit-tap-highlight-color:transparent]',
    'transition-[transform,filter]',
    'duration-100',
    'ease-out',
    'active:translate-y-px',
    'active:scale-[0.98]',
    'active:brightness-[0.93]',
    'disabled:translate-y-0',
    'disabled:scale-100',
    'disabled:brightness-100',
  ],
  theme: {
    extend: {
      colors: {
        'inactive-red': '#560D0D',
        'brand-yellow': '#F1B04C',
        'brand-orange': '#E88504',
      }
    },
  },
  plugins: [],
} 