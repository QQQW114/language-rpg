import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, MemoryAnchor } from '@/types/game';
import { OrnateDivider } from './ui/Ornaments';
import { Bookmark, BookmarkCheck, Check, Pencil, RotateCw, Sparkles, X } from 'lucide-react';
import { clsx } from '@/lib/utils';

interface StoryViewProps {
  history: Message[];
  streaming?: string;   // 当前正在流式输出的文本（可选）
  phase: 'story' | 'choices' | 'manual' | 'ended';
  anchors?: MemoryAnchor[];
  onPinAnchor?: (msg: Message) => void;
  onUnpinAnchor?: (anchorId: string) => void;
  onEditAssistant?: (historyIndex: number, msg: Message, content: string) => void;
  onRegenerateAssistant?: (historyIndex: number, msg: Message) => void;
  onRegenerateAssistantWithHint?: (historyIndex: number, msg: Message, hint: string) => void;
  canEditAssistant?: (historyIndex: number, msg: Message) => boolean;
  canRegenerateAssistant?: (historyIndex: number, msg: Message) => boolean;
}

const markdownComponents = {
  p: (props: any) => <p {...props} />,
  strong: (props: any) => <strong {...props} />,
  em: (props: any) => <em {...props} />,
  blockquote: (props: any) => <blockquote {...props} />,
};

export function StoryView({
  history,
  streaming,
  phase,
  anchors,
  onPinAnchor,
  onUnpinAnchor,
  onEditAssistant,
  onRegenerateAssistant,
  onRegenerateAssistantWithHint,
  canEditAssistant,
  canRegenerateAssistant,
}: StoryViewProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const [editingIndex, setEditingIndex] = useState<number | undefined>();
  const [editingText, setEditingText] = useState('');
  const [hintIndex, setHintIndex] = useState<number | undefined>();
  const [hintText, setHintText] = useState('');

  // 建立 round -> anchor 的映射（一个 round 可能多次被锚定，但我们只取第一个标记 UI）
  const anchorByRound = new Map<number, MemoryAnchor>();
  for (const a of anchors ?? []) {
    if (!anchorByRound.has(a.round)) anchorByRound.set(a.round, a);
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history.length, streaming, phase]);

  return (
    <div className="prose-story">
      {history.map((m, i) => {
        if (m.role === 'assistant') {
          const pinned = anchorByRound.get(m.round);
          const editing = editingIndex === i;
          const hinting = hintIndex === i;
          const editEnabled = !!onEditAssistant && (!canEditAssistant || canEditAssistant(i, m));
          const regenEnabled = !!onRegenerateAssistant && (!canRegenerateAssistant || canRegenerateAssistant(i, m));
          const regenWithHintEnabled = !!onRegenerateAssistantWithHint && (!canRegenerateAssistant || canRegenerateAssistant(i, m));
          const hasControls = onPinAnchor || onUnpinAnchor || editEnabled || regenEnabled || regenWithHintEnabled;
          const iconButtonClass =
            'p-1 rounded text-parchment-200/50 hover:text-gold-light hover:bg-parchment-800/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed';
          return (
            <div key={i} className="mb-4 group relative">
              {i > 0 && <OrnateDivider>{`第 ${m.round} 回合`}</OrnateDivider>}
              {editing ? (
                <div className="rounded-md border border-gold/50 bg-parchment-900/50 p-3 shadow-glow-sm">
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    className="w-full min-h-[220px] resize-y rounded-md border border-parchment-600/50 bg-ink/40 px-3 py-2 font-serif text-sm leading-relaxed text-parchment-50 outline-none focus:border-gold/80"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingIndex(undefined);
                        setEditingText('');
                      }}
                      className="rounded border border-parchment-600/50 px-2 py-1 text-xs text-parchment-200/80 hover:border-gold/60 hover:text-gold-light"
                    >
                      <X size={12} className="inline mr-1" />取消
                    </button>
                    <button
                      type="button"
                      disabled={!editingText.trim()}
                      onClick={() => {
                        onEditAssistant?.(i, m, editingText);
                        setEditingIndex(undefined);
                        setEditingText('');
                      }}
                      className="rounded border border-gold/60 px-2 py-1 text-xs text-gold-light hover:bg-gold/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Check size={12} className="inline mr-1" />保存
                    </button>
                  </div>
                </div>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {m.content}
                </ReactMarkdown>
              )}
              {hinting && (
                <div className="mt-3 rounded-md border border-gold/40 bg-parchment-900/50 p-3 shadow-glow-sm">
                  <div className="mb-2 text-xs tracking-[0.25em] text-gold/70 font-serif uppercase">
                    增强重新请求 · 重要参考
                  </div>
                  <textarea
                    value={hintText}
                    onChange={(e) => setHintText(e.target.value)}
                    placeholder="写下希望模型重写时重点参考的提示，例如：加强母亲的情绪、保留雨夜氛围、不要立刻揭露真相……"
                    className="w-full min-h-[110px] resize-y rounded-md border border-parchment-600/50 bg-ink/40 px-3 py-2 font-serif text-sm leading-relaxed text-parchment-50 outline-none focus:border-gold/80 placeholder:text-parchment-200/35"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setHintIndex(undefined);
                        setHintText('');
                      }}
                      className="rounded border border-parchment-600/50 px-2 py-1 text-xs text-parchment-200/80 hover:border-gold/60 hover:text-gold-light"
                    >
                      <X size={12} className="inline mr-1" />取消
                    </button>
                    <button
                      type="button"
                      disabled={!hintText.trim()}
                      onClick={() => {
                        onRegenerateAssistantWithHint?.(i, m, hintText);
                        setHintIndex(undefined);
                        setHintText('');
                      }}
                      className="rounded border border-gold/60 px-2 py-1 text-xs text-gold-light hover:bg-gold/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Sparkles size={12} className="inline mr-1" />确认重写
                    </button>
                  </div>
                </div>
              )}
              {hasControls && (
                <div
                  className={clsx(
                    'absolute -left-8 top-1 flex flex-col gap-1 transition-opacity',
                    pinned || editing || hinting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                >
                  {(onPinAnchor || onUnpinAnchor) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (pinned) onUnpinAnchor?.(pinned.id);
                        else onPinAnchor?.(m);
                      }}
                      title={pinned ? '取消记忆锚点' : '标记为记忆锚点（模型会在后续叙事中呼应）'}
                      className={clsx(iconButtonClass, pinned && 'text-gold-light')}
                    >
                      {pinned ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                    </button>
                  )}
                  {editEnabled && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingIndex(i);
                        setEditingText(m.content);
                      }}
                      title="编辑这次模型回复，并按新文本重新生成后续选项"
                      className={clsx(iconButtonClass, editing && 'text-gold-light')}
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                  {regenEnabled && (
                    <button
                      type="button"
                      onClick={() => onRegenerateAssistant?.(i, m)}
                      title="直接重新请求这次模型回复"
                      className={iconButtonClass}
                    >
                      <RotateCw size={16} />
                    </button>
                  )}
                  {regenWithHintEnabled && (
                    <button
                      type="button"
                      onClick={() => {
                        setHintIndex(i);
                        setHintText('');
                      }}
                      title="增强重新请求：附加重要参考提示词"
                      className={clsx(iconButtonClass, hinting && 'text-gold-light')}
                    >
                      <Sparkles size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        }
        if (m.role === 'user') {
          return (
            <div
              key={i}
              className="my-4 pl-3 border-l-2 border-gold/50 text-parchment-200/80 italic"
              style={{ textIndent: 0 }}
            >
              <span className="text-gold/70 mr-1">▸</span>
              <span>{m.content}</span>
            </div>
          );
        }
        return null;
      })}
      {streaming && (
        <div className="mb-4">
          {history.length > 0 && <OrnateDivider>{`第 ${history[history.length - 1].round + (history[history.length - 1].role === 'assistant' ? 1 : 0)} 回合`}</OrnateDivider>}
          <div className="caret">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {streaming}
            </ReactMarkdown>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
