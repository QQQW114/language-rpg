import React from 'react';
import { clsx } from '@/lib/utils';

interface OrnateDividerProps {
  children?: React.ReactNode;
  className?: string;
}

export function OrnateDivider({ children, className }: OrnateDividerProps) {
  return (
    <div className={clsx('divider-ornate my-6 font-serif text-sm', className)}>
      {children ?? (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden>
          <path d="M9 1 L11 7 L17 9 L11 11 L9 17 L7 11 L1 9 L7 7 Z" />
        </svg>
      )}
    </div>
  );
}

export function CornerFiligree({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 80 80"
      className={clsx('text-gold/40', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
    >
      <path d="M2 40 C10 20 20 10 40 2 M2 40 C10 60 20 70 40 78" />
      <circle cx="8" cy="40" r="2" />
      <path d="M14 34 C18 30 22 28 26 26" />
      <path d="M14 46 C18 50 22 52 26 54" />
    </svg>
  );
}
