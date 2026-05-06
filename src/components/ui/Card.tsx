import React from 'react';
import { clsx } from '@/lib/utils';

type CardVariant = 'parchment' | 'engraved' | 'luminous';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  selected?: boolean;
  variant?: CardVariant;
}

const variantStyles: Record<CardVariant, string> = {
  parchment:
    'paper-card',
  engraved:
    'bg-[linear-gradient(180deg,rgba(15,10,5,0.85)_0%,rgba(26,18,11,0.92)_100%)] ' +
    'border border-parchment-700/60 shadow-inset-deep',
  luminous:
    'bg-[linear-gradient(180deg,rgba(74,56,32,0.45)_0%,rgba(42,31,20,0.85)_100%)] ' +
    'border border-gold/45 shadow-glow-sm',
};

export function Card({
  interactive,
  selected,
  variant = 'parchment',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      className={clsx(
        'relative rounded-md backdrop-blur-[1px] p-5 transition-all duration-250 ease-out-expo',
        variantStyles[variant],
        interactive &&
          'cursor-pointer hover:border-gold/70 hover:shadow-glow-sm hover:-translate-y-[1px]',
        selected && 'border-gold !shadow-glow ring-1 ring-gold/60',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={clsx(
        'text-lg font-semibold text-gold-light tracking-[0.08em] mb-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardMeta({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={clsx('text-xs text-parchment-200/70 mb-2 leading-relaxed', className)}
    >
      {children}
    </div>
  );
}
