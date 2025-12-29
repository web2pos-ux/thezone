/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
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