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
        // 烛火点缀（critical 警示 / 朱砂蜡封内焰）
        ember: { DEFAULT: '#c2622a', light: '#e08043', dark: '#8a3f15' },
        // 古书铜锈（success / 已完成 / 多次性道具）
        moss: { DEFAULT: '#5d6d4a', light: '#8a9a73', dark: '#3a4630' },
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"LXGW WenKai"', 'Georgia', 'serif'],
        sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Source Code Pro"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // 古籍排版用的精确字号 + 字距
        inscription: ['10px', { letterSpacing: '0.3em', lineHeight: '1.2' }],
        caption: ['11px', { letterSpacing: '0.15em', lineHeight: '1.5' }],
        meta: ['12px', { letterSpacing: '0.1em', lineHeight: '1.6' }],
        body: ['15px', { lineHeight: '1.85', letterSpacing: '0.02em' }],
        reader: ['17px', { lineHeight: '2', letterSpacing: '0.03em' }],
        'title-sm': ['18px', { letterSpacing: '0.08em' }],
        title: ['22px', { letterSpacing: '0.12em' }],
        'title-lg': ['28px', { letterSpacing: '0.15em' }],
      },
      boxShadow: {
        glow: '0 0 18px rgba(201, 165, 102, 0.35)',
        'glow-sm': '0 0 8px rgba(201, 165, 102, 0.28)',
        'glow-lg': '0 0 36px rgba(201, 165, 102, 0.42)',
        parchment: 'inset 0 0 40px rgba(0,0,0,0.35)',
        'inset-deep':
          'inset 0 2px 6px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(201,165,102,0.12)',
        engraved:
          'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.5), 0 1px 0 rgba(201,165,102,0.15)',
        foil:
          '0 1px 0 rgba(255,230,170,0.3), 0 -1px 0 rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.5)',
        'blood-glow': '0 0 14px rgba(138, 47, 47, 0.45)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in-expo': 'cubic-bezier(0.7, 0, 0.84, 0)',
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
        'wax': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        250: '250ms',
        350: '350ms',
        600: '600ms',
        900: '900ms',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': { '0%,100%': { opacity: '0.6' }, '50%': { opacity: '1' } },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        // 金线动画（核心 UI 语言）
        'line-draw-in': {
          '0%': { transform: 'scaleX(0)', opacity: '0.4' },
          '100%': { transform: 'scaleX(1)', opacity: '1' },
        },
        'line-draw-out': {
          '0%': { transform: 'scaleX(1)', opacity: '1' },
          '100%': { transform: 'scaleX(0)', opacity: '0.4' },
        },
        'char-reveal': {
          '0%': { opacity: '0', transform: 'translateY(2px)', filter: 'blur(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        'char-vanish': {
          '0%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
          '100%': { opacity: '0', transform: 'translateY(-2px)', filter: 'blur(4px)' },
        },
        'slide-up-in': {
          '0%': { transform: 'translateY(28px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-down-out': {
          '0%': { transform: 'translateY(0)', opacity: '1' },
          '100%': { transform: 'translateY(28px)', opacity: '0' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(36px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-out-right': {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(36px)', opacity: '0' },
        },
        'foil-shine': {
          '0%,100%': { backgroundPosition: '-200% 50%' },
          '50%': { backgroundPosition: '200% 50%' },
        },
        'wax-press': {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.08)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'dialog-in': {
          '0%': { transform: 'translateY(8px) scale(0.96)', opacity: '0' },
          '100%': { transform: 'translateY(0) scale(1)', opacity: '1' },
        },
        'ink-bloom': {
          '0%': { opacity: '0', filter: 'blur(3px)', transform: 'translateY(2px)' },
          '60%': { opacity: '0.85', filter: 'blur(1px)' },
          '100%': { opacity: '1', filter: 'blur(0)', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out both',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
        shimmer: 'shimmer 3.2s linear infinite',
        'line-in': 'line-draw-in 0.65s cubic-bezier(0.16, 1, 0.3, 1) both',
        'line-out': 'line-draw-out 0.5s cubic-bezier(0.7, 0, 0.84, 0) both',
        'slide-up-in': 'slide-up-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-down-out': 'slide-down-out 0.35s cubic-bezier(0.7, 0, 0.84, 0) both',
        'slide-in-right': 'slide-in-right 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-out-right': 'slide-out-right 0.3s cubic-bezier(0.7, 0, 0.84, 0) both',
        foil: 'foil-shine 6s ease-in-out infinite',
        'wax-press': 'wax-press 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'dialog-in': 'dialog-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
        'ink-bloom': 'ink-bloom 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
      backgroundImage: {
        'parchment-grain':
          'radial-gradient(ellipse at top, rgba(201,165,102,0.06), transparent 60%), radial-gradient(ellipse at bottom, rgba(138,47,47,0.05), transparent 60%)',
        'gold-foil':
          'linear-gradient(110deg, #8d7340 0%, #c9a566 30%, #f0d68a 50%, #c9a566 70%, #8d7340 100%)',
        'gold-line':
          'linear-gradient(90deg, transparent 0%, rgba(201,165,102,0.35) 8%, rgba(227,194,126,0.95) 50%, rgba(201,165,102,0.35) 92%, transparent 100%)',
        'gold-line-dim':
          'linear-gradient(90deg, transparent 0%, rgba(141,115,64,0.5) 50%, transparent 100%)',
        'paper-edge':
          'linear-gradient(180deg, rgba(26,18,11,0.0), rgba(26,18,11,0.85))',
        'paper-card':
          'linear-gradient(180deg, rgba(42,31,20,0.85) 0%, rgba(26,18,11,0.92) 100%)',
        'wax-seal':
          'radial-gradient(circle at 35% 30%, #c2622a 0%, #8a2f2f 55%, #4a1717 100%)',
        'wax-seal-gold':
          'radial-gradient(circle at 35% 30%, #f0d68a 0%, #c9a566 50%, #6b5230 100%)',
      },
    },
  },
  plugins: [],
};
