import React, { useState } from 'react';
import { Textarea } from './ui/Input';
import { Button } from './ui/Button';
import { Send } from 'lucide-react';

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
    <div className="flex flex-col gap-2">
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
      <div className="flex justify-end">
        <Button onClick={submit} disabled={disabled || !value.trim()}>
          <Send size={16} /> 发送
        </Button>
      </div>
    </div>
  );
}
