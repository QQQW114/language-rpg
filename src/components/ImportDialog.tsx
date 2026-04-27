import React, { useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Textarea } from './ui/Input';
import { Upload, AlertCircle } from 'lucide-react';
import { useContentStore } from '@/store/useContentStore';
import type { ImportBundle } from '@/types/content';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
}

const SAMPLE = `{
  "worldBooks": [
    {
      "id": "wb_my_world",
      "name": "我的自定义世界书",
      "entries": [
        { "id": "wbe_1", "name": "世界基调", "keywords": [], "alwaysActive": true, "priority": 100, "content": "这里描述整个世界的基本设定……" },
        { "id": "wbe_2", "name": "神秘组织", "keywords": ["暗影会", "暗夜"], "content": "当提及这个组织时注入……" }
      ]
    }
  ],
  "outlines": [
    { "id": "outline_custom", "title": "我的故事", "synopsis": "一个……", "acts": ["第一幕…","第二幕…","第三幕…"], "tone": "……" }
  ],
  "backgrounds": [
    { "id": "bg_custom", "name": "我的出身", "description": "……", "traits": ["剑术"], "startItems": ["短剑"], "startScene": "你醒来……" }
  ],
  "events": [
    { "id": "ev_custom", "name": "神秘信件", "directive": "让玩家收到一封奇怪的信……", "probability": 0.1, "minRound": 3, "cooldown": 15 }
  ]
}`;

export function ImportDialog({ open, onClose }: ImportDialogProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const importBundle = useContentStore((s) => s.importBundle);

  const doImport = () => {
    setError(undefined);
    try {
      const obj = JSON.parse(text) as ImportBundle;
      const { added } = importBundle(obj);
      setText('');
      onClose();
      alert(`成功导入 ${added} 项内容。`);
    } catch (e: any) {
      setError('JSON 解析失败：' + (e?.message ?? String(e)));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="导入自定义内容" widthClass="max-w-3xl">
      <div className="text-sm text-parchment-200/80 mb-3 leading-relaxed">
        粘贴下方格式的 JSON，可同时导入多类内容（任一字段可缺省）。已存在同 id 的内容会被跳过。
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        placeholder={SAMPLE}
        className="font-mono text-xs"
      />
      {error && (
        <div className="mt-3 flex items-start gap-2 text-sm text-blood bg-blood/10 border border-blood/50 rounded px-3 py-2">
          <AlertCircle size={16} className="mt-0.5" />
          <div>{error}</div>
        </div>
      )}
      <div className="mt-4 flex justify-between items-center">
        <Button variant="ghost" onClick={() => setText(SAMPLE)}>填入示例</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={doImport} disabled={!text.trim()}>
            <Upload size={16} /> 导入
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
