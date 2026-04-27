import { useState } from 'react';
import type { MemoryAnchor } from '@/types/game';
import { Bookmark, X, Edit2 } from 'lucide-react';

interface AnchorsListProps {
  anchors: MemoryAnchor[];
  onRemove: (id: string) => void;
  onUpdateNote: (id: string, note: string) => void;
}

export function AnchorsList({ anchors, onRemove, onUpdateNote }: AnchorsListProps) {
  const [editId, setEditId] = useState<string | undefined>();
  const [editVal, setEditVal] = useState('');

  if (!anchors?.length) return null;

  const startEdit = (a: MemoryAnchor) => {
    setEditId(a.id);
    setEditVal(a.note ?? '');
  };
  const saveEdit = () => {
    if (editId) onUpdateNote(editId, editVal.trim().slice(0, 60));
    setEditId(undefined);
    setEditVal('');
  };

  return (
    <section>
      <h3 className="flex items-center gap-2 text-gold-light tracking-wider mb-2 text-xs uppercase">
        <Bookmark size={14} /> 记忆锚点 · {anchors.length}
      </h3>
      <div className="space-y-1.5">
        {anchors.slice().reverse().slice(0, 8).map((a) => (
          <div
            key={a.id}
            className="relative bg-parchment-800/60 border border-parchment-600/40 rounded px-2 py-1.5 text-xs group"
          >
            <div className="flex items-start justify-between gap-1">
              <div className="text-[10px] text-gold/70 tracking-wider">第 {a.round} 回合</div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => startEdit(a)}
                  className="text-parchment-200/60 hover:text-gold-light"
                  title="编辑备注"
                >
                  <Edit2 size={10} />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(a.id)}
                  className="text-parchment-200/60 hover:text-blood"
                  title="移除"
                >
                  <X size={10} />
                </button>
              </div>
            </div>
            {editId === a.id ? (
              <div className="mt-1 flex gap-1">
                <input
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') { setEditId(undefined); setEditVal(''); } }}
                  onBlur={saveEdit}
                  autoFocus
                  placeholder="备注（可选）"
                  maxLength={60}
                  className="flex-1 bg-parchment-900/80 border border-gold/40 rounded px-1 py-0.5 text-[11px] text-parchment-50 focus:outline-none"
                />
              </div>
            ) : a.note ? (
              <div className="text-gold-light font-serif mt-0.5">{a.note}</div>
            ) : null}
            <div className="text-parchment-200/70 italic line-clamp-2 mt-0.5">{a.excerpt}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
