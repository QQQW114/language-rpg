import React from 'react';
import { clsx } from '@/lib/utils';

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string };
type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string };

const fieldBase =
  'w-full bg-parchment-900/70 text-parchment-100 placeholder:italic placeholder:text-parchment-200/40 ' +
  'border border-parchment-600/55 rounded-md px-3 py-2 font-serif ' +
  'shadow-[inset_0_1px_3px_rgba(0,0,0,0.45),inset_0_-1px_0_rgba(201,165,102,0.08)] ' +
  'focus:outline-none focus:border-gold/75 focus:shadow-[inset_0_1px_3px_rgba(0,0,0,0.45),0_0_0_1px_rgba(201,165,102,0.35),0_0_18px_rgba(201,165,102,0.18)] ' +
  'transition-all duration-250 ease-out-expo';

export function Field({
  label,
  hint,
  children,
}: {
  label?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block mb-4">
      {label && (
        <span className="block text-sm text-gold-light mb-1.5 tracking-[0.08em]">{label}</span>
      )}
      {children}
      {hint && <span className="block text-xs text-parchment-200/60 mt-1.5 italic">{hint}</span>}
    </label>
  );
}

export function Input({ label, hint, className, ...rest }: InputProps) {
  const el = <input {...rest} className={clsx(fieldBase, className)} />;
  if (label || hint) return <Field label={label} hint={hint}>{el}</Field>;
  return el;
}

export function Textarea({ label, hint, className, ...rest }: TextareaProps) {
  const el = (
    <textarea
      {...rest}
      className={clsx(fieldBase, 'min-h-[90px] resize-y leading-relaxed', className)}
    />
  );
  if (label || hint) return <Field label={label} hint={hint}>{el}</Field>;
  return el;
}
