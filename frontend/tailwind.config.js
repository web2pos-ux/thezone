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
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fadeIn': 'fadeIn 0.5s ease-out forwards',
        'fadeOut': 'fadeOut 0.5s ease-out forwards',
        'slideUp': 'slideUp 0.5s ease-out forwards',
      }
    },
  },
  plugins: [],
} 