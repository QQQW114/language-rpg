import React from 'react';
import { clsx } from '@/lib/utils';

interface OrnateDividerProps {
  children?: React.ReactNode;
  className?: string;
  decoration?: 'diamond' | 'seal' | 'leaf' | 'cloud';
}

export function OrnateDivider({ children, className, decoration = 'diamond' }: OrnateDividerProps) {
  const Glyph = (() => {
    if (children) return null;
    if (decoration === 'seal') {
      return (
        <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-wax-seal-gold shadow-glow-sm" />
      );
    }
    if (decoration === 'leaf') {
      return (
        <svg width="20" height="14" viewBox="0 0 20 14" fill="currentColor" aria-hidden>
          <path d="M10 1 C 6 4, 2 7, 1 13 C 4 11, 8 10, 10 7 C 12 10, 16 11, 19 13 C 18 7, 14 4, 10 1 Z" />
        </svg>
      );
    }
    if (decoration === 'cloud') {
      return (
        <svg width="22" height="10" viewBox="0 0 22 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
          <path d="M1 6 C3 2, 7 2, 9 6 C11 2, 15 2, 17 6 C19 4, 21 6, 21 8" />
        </svg>
      );
    }
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden>
        <path d="M9 1 L11 7 L17 9 L11 11 L9 17 L7 11 L1 9 L7 7 Z" />
      </svg>
    );
  })();

  return (
    <div className={clsx('divider-ornate my-6 font-serif text-sm', className)}>
      {children ?? Glyph}
    </div>
  );
}

export function CornerFiligree({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 80 80"
      className={clsx('text-gold/40', className)}
      style={style}
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

interface WaxSealProps {
  text?: string;
  number?: number;
  variant?: 'red' | 'gold' | 'blood';
  size?: number;
  pressed?: boolean;
  className?: string;
  title?: string;
}

export function WaxSeal({
  text,
  number,
  variant = 'red',
  size = 36,
  pressed,
  className,
  title,
}: WaxSealProps) {
  const bgClass =
    variant === 'gold'
      ? 'bg-wax-seal-gold'
      : variant === 'blood'
      ? 'bg-[radial-gradient(circle_at_35%_30%,#a83b3b_0%,#5a1818_55%,#2a0a0a_100%)]'
      : 'bg-wax-seal';
  const textColor = variant === 'gold' ? 'text-parchment-900' : 'text-gold-light';
  const display = number !== undefined ? String(number) : text;

  return (
    <span
      title={title}
      className={clsx(
        'relative inline-flex items-center justify-center rounded-full font-serif font-bold select-none',
        bgClass,
        textColor,
        !pressed && 'animate-wax-press',
        className,
      )}
      style={{
        width: size,
        height: size,
        boxShadow:
          '0 1px 0 rgba(255,230,170,0.25), 0 -1px 0 rgba(0,0,0,0.5), 0 4px 14px rgba(0,0,0,0.55), inset 0 -2px 4px rgba(0,0,0,0.45), inset 0 2px 3px rgba(255,255,255,0.12)',
        textShadow: '0 1px 0 rgba(0,0,0,0.55)',
        fontSize: size * 0.42,
        lineHeight: 1,
      }}
    >
      <span
        className="pointer-events-none absolute inset-1 rounded-full"
        style={{
          boxShadow:
            'inset 0 0 0 1px rgba(0,0,0,0.35), inset 0 0 0 2px rgba(255,255,255,0.06)',
        }}
      />
      <span className="relative">{display}</span>
    </span>
  );
}

interface BeveledFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  cornerSize?: number;
  inset?: number;
}

export function BeveledFrame({
  children,
  cornerSize = 64,
  inset = -8,
  className,
  ...rest
}: BeveledFrameProps) {
  const offset = `${inset}px`;
  return (
    <div {...rest} className={clsx('relative', className)}>
      <CornerFiligree
        className="pointer-events-none absolute"
        style={{ top: offset, left: offset, width: cornerSize, height: cornerSize }}
      />
      <CornerFiligree
        className="pointer-events-none absolute rotate-90"
        style={{ top: offset, right: offset, width: cornerSize, height: cornerSize }}
      />
      <CornerFiligree
        className="pointer-events-none absolute -rotate-90"
        style={{ bottom: offset, left: offset, width: cornerSize, height: cornerSize }}
      />
      <CornerFiligree
        className="pointer-events-none absolute rotate-180"
        style={{ bottom: offset, right: offset, width: cornerSize, height: cornerSize }}
      />
      {children}
    </div>
  );
}

export function FoldedCorner({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={clsx('pointer-events-none absolute top-0 right-0', className)}
      style={{
        width: size,
        height: size,
        clipPath: 'polygon(100% 0, 0 0, 100% 100%)',
        background:
          'linear-gradient(135deg, rgba(141,115,64,0.55) 0%, rgba(74,56,32,0.85) 50%, rgba(15,10,5,1) 100%)',
        boxShadow: 'inset -1px 1px 0 rgba(201,165,102,0.35)',
      }}
    />
  );
}
