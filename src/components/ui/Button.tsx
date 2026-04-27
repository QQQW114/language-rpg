import React from 'react';
import { clsx } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-2 font-serif tracking-wide transition-all duration-200 select-none ' +
  'rounded-md border disabled:opacity-45 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-gold-light to-gold-dark text-parchment-800 border-gold-dark hover:brightness-110 hover:shadow-glow active:brightness-95',
  ghost:
    'bg-transparent text-parchment-100 border-transparent hover:bg-parchment-700/50',
  outline:
    'bg-parchment-800/60 text-parchment-100 border-parchment-500/40 hover:border-gold/70 hover:shadow-glow-sm',
  danger:
    'bg-gradient-to-b from-blood/90 to-blood text-parchment-50 border-blood hover:brightness-110 hover:shadow-[0_0_16px_rgba(138,47,47,0.45)]',
};

const sizes: Record<Size, string> = {
  sm: 'text-sm px-3 h-8',
  md: 'text-base px-4 h-10',
  lg: 'text-lg px-6 h-12',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(base, variants[variant], sizes[size], className)}
    >
      {loading && (
        <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  );
}
