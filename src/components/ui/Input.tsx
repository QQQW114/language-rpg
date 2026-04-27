import React from 'react';
import { clsx } from '@/lib/utils';

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string };
type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string };

const fieldBase =
  'w-full bg-parchment-900/60 text-parchment-100 placeholder-parchment-200/40 ' +
  'border border-parchment-600/50 rounded-md px-3 py-2 font-serif ' +
  'focus:outline-none focus:border-gold/70 focus:shadow-glow-sm transition-all';

export function Field({
  label, hint, children,
}: { label?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block mb-4">
      {label && (
        <span className="block text-sm text-gold-light mb-1 tracking-wide">{label}</span>
      )}
      {children}
      {hint && <span className="block text-xs text-parchment-200/60 mt-1">{hint}</span>}
    </label>
  );
}

export function Input({ label, hint, className, ...rest }: InputProps) {
  const el = <input {...rest} className={clsx(fieldBase, className)} />;
  if (label || hint) return <Field label={label} hint={hint}>{el}</Field>;
  return el;
}

export function Textarea({ label, hint, className, ...rest }: TextareaProps) {
  const el = <textarea {...rest} className={clsx(fieldBase, 'min-h-[90px] resize-y leading-relaxed', className)} />;
  if (label || hint) return <Field label={label} hint={hint}>{el}</Field>;
  return el;
}
