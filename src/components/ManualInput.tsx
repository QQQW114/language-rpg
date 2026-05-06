import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { Textarea } from './ui/Input';
import { Button } from './ui/Button';

interface ManualInputProps {
  disabled?: boolean;
  onSubmit: (text: string) => void;
  placeholder?: string;
}

export function ManualInput({ disabled, onSubmit, placeholder }: ManualInputProps) {
  const [value, setValue] = useState('');

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
    setValue('');
  };

  return (
    <div className="relative flex flex-col gap-2 pt-1">
      {/* 顶部一条金线分割（始终可见，提示这是输入区） */}
      <div aria-hidden className="pointer-events-none mb-1 h-px bg-gold-line opacity-60" />
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? '此回合可自由行动——描述你想做的事（Ctrl + Enter 发送）'}
        disabled={disabled}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] tracking-[0.2em] text-parchment-200/45 font-serif italic">
          ⌘ / Ctrl + Enter 即落笔
        </span>
        <Button onClick={submit} disabled={disabled || !value.trim()}>
          <Send size={16} /> 送出
        </Button>
      </div>
    </div>
  );
}
