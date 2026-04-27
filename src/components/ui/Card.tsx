import React from 'react';
import { clsx } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  selected?: boolean;
}

export function Card({
  interactive,
  selected,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      className={clsx(
        'relative rounded-md border bg-parchment-800/70 backdrop-blur-[1px] p-5',
        'border-parchment-600/50 shadow-parchment',
        interactive && 'cursor-pointer transition-all duration-200 hover:border-gold/70 hover:shadow-glow-sm',
        selected && 'border-gold shadow-glow ring-1 ring-gold/60',
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
      className={clsx('text-lg font-semibold text-gold-light tracking-wide mb-2', className)}
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
      className={clsx('text-xs text-parchment-200/70 mb-2', className)}
    >
      {children}
    </div>
  );
}
