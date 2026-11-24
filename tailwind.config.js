/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        island: {
          bg: "rgba(15, 17, 23, 0.92)",
          card: "rgba(26, 29, 38, 0.85)",
          border: "rgba(255, 255, 255, 0.08)",
          accent: "#38bdf8",
        }
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'wave': 'wave 1.2s ease-in-out infinite',
      },
      keyframes: {
        wave: {
          '0%, 100%': { height: '4px' },
          '50%': { height: '14px' },
        }
      }
    },
  },
  plugins: [],
}
