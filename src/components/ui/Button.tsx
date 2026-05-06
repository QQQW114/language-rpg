import React from 'react';
import { clsx } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'danger' | 'outline' | 'seal';
type Size = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const base =
  'relative inline-flex items-center justify-center gap-2 font-serif tracking-wide select-none ' +
  'transition-all duration-250 ease-out-expo ' +
  'rounded-md border disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:shadow-none ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-1 focus-visible:ring-offset-ink ' +
  'active:scale-[0.97] active:transition-transform active:duration-100';

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-gold-light to-gold-dark text-parchment-800 border-gold-dark ' +
    'shadow-[inset_0_1px_0_rgba(255,230,170,0.4),inset_0_-1px_0_rgba(0,0,0,0.3),0_2px_8px_rgba(0,0,0,0.4)] ' +
    'hover:brightness-110 hover:shadow-foil',
  ghost:
    'bg-transparent text-parchment-100 border-transparent hover:bg-parchment-700/40 hover:text-gold-light',
  outline:
    'bg-parchment-800/60 text-parchment-100 border-parchment-500/50 ' +
    'shadow-engraved hover:border-gold/70 hover:shadow-glow-sm hover:text-gold-light',
  danger:
    'bg-gradient-to-b from-blood/95 to-blood text-parchment-50 border-blood/80 ' +
    'shadow-[inset_0_1px_0_rgba(255,200,200,0.18),inset_0_-1px_0_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.45)] ' +
    'hover:brightness-110 hover:shadow-blood-glow',
  seal:
    'bg-wax-seal-gold text-parchment-900 border-gold-dark/70 rounded-full ' +
    'shadow-[inset_0_-2px_4px_rgba(0,0,0,0.45),inset_0_2px_3px_rgba(255,255,255,0.18),0_4px_14px_rgba(0,0,0,0.5)] ' +
    'hover:brightness-110 hover:shadow-foil',
};

const sizes: Record<Size, string> = {
  xs: 'text-[11px] px-2 h-6',
  sm: 'text-sm px-3 h-8',
  md: 'text-base px-4 h-10',
  lg: 'text-lg px-6 h-12',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, className, children, disabled, ...rest },
  ref,
) {
  const isSeal = variant === 'seal';
  return (
    <button
      ref={ref}
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        base,
        variants[variant],
        sizes[size],
        isSeal && 'aspect-square px-0',
        className,
      )}
    >
      {loading && (
        <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  );
});
