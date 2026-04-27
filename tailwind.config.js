/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        parchment: {
          50: '#f6ecd6',
          100: '#ede0c8',
          200: '#d8c59e',
          300: '#b39969',
          400: '#8f7346',
          500: '#6b5230',
          600: '#4a3820',
          700: '#2a1f14',
          800: '#1a120b',
          900: '#0f0a05',
        },
        gold: {
          DEFAULT: '#c9a566',
          light: '#e3c27e',
          dark: '#8d7340',
        },
        blood: '#8a2f2f',
        ink: '#1a120b',
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"LXGW WenKai"', 'Georgia', 'serif'],
        sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 18px rgba(201, 165, 102, 0.35)',
        'glow-sm': '0 0 8px rgba(201, 165, 102, 0.28)',
        parchment: 'inset 0 0 40px rgba(0,0,0,0.35)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'pulse-soft': { '0%,100%': { opacity: '0.6' }, '50%': { opacity: '1' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out both',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
        shimmer: 'shimmer 3.2s linear infinite',
      },
      backgroundImage: {
        'parchment-grain':
          'radial-gradient(ellipse at top, rgba(201,165,102,0.06), transparent 60%), radial-gradient(ellipse at bottom, rgba(138,47,47,0.05), transparent 60%)',
      },
    },
  },
  plugins: [],
};
