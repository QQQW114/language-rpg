import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, MemoryAnchor } from '@/types/game';
import { GoldLine } from './ui/GoldLine';
import { Bookmark, BookmarkCheck, Check, Pencil, RotateCw, Sparkles, Trash2, X } from 'lucide-react';
import { clsx } from '@/lib/utils';
import { ThinkToggle } from '@/components/ThinkToggle';

interface StoryViewProps {
  history: Message[];
  streaming?: string;
  streamingThinking?: string;
  phase: 'story' | 'choices' | 'manual' | 'ended';
  anchors?: MemoryAnchor[];
  onPinAnchor?: (msg: Message) => void;
  onUnpinAnchor?: (anchorId: string) => void;
  onEditMessage?: (historyIndex: number, msg: Message, content: string) => void;
  onDeleteMessage?: (historyIndex: number, msg: Message) => void;
  onEditAssistant?: (historyIndex: number, msg: Message, content: string) => void;
  onRegenerateAssistant?: (historyIndex: number, msg: Message) => void;
  onRegenerateAssistantWithHint?: (historyIndex: number, msg: Message, hint: string) => void;
  canModifyMessage?: (historyIndex: number, msg: Message) => boolean;
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
  streamingThinking,
  phase,
  anchors,
  onPinAnchor,
  onUnpinAnchor,
  onEditMessage,
  onDeleteMessage,
  onEditAssistant,
  onRegenerateAssistant,
  onRegenerateAssistantWithHint,
  canModifyMessage,
  canEditAssistant,
  canRegenerateAssistant,
}: StoryViewProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const [editingIndex, setEditingIndex] = useState<number | undefined>();
  const [editingText, setEditingText] = useState('');
  const [hintIndex, setHintIndex] = useState<number | undefined>();
  const [hintText, setHintText] = useState('');

  const anchorByRound = new Map<number, MemoryAnchor>();
  for (const a of anchors ?? []) {
    if (!anchorByRound.has(a.round)) anchorByRound.set(a.round, a);
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history.length, streaming, streamingThinking, phase]);

  const saveEdit = (index: number, msg: Message) => {
    if (onEditMessage) onEditMessage(index, msg, editingText);
    else if (msg.role === 'assistant') onEditAssistant?.(index, msg, editingText);
    setEditingIndex(undefined);
    setEditingText('');
  };

  const streamingRoundLabel = (() => {
    if (history.length === 0) return 0;
    const last = history[history.length - 1];
    return last.role === 'assistant' ? last.round + 1 : last.round;
  })();

  return (
    <div className="prose-story">
      {history.map((m, i) => {
        const editing = editingIndex === i;
        const modifyEnabled = !!onEditMessage && (!canModifyMessage || canModifyMessage(i, m));
        const deleteEnabled = !!onDeleteMessage && (!canModifyMessage || canModifyMessage(i, m));

        if (m.role === 'assistant') {
          const pinned = anchorByRound.get(m.round);
          const hinting = hintIndex === i;
          const editEnabled = modifyEnabled || (!!onEditAssistant && (!canEditAssistant || canEditAssistant(i, m)));
          const regenEnabled = !!onRegenerateAssistant && (!canRegenerateAssistant || canRegenerateAssistant(i, m));
          const regenWithHintEnabled = !!onRegenerateAssistantWithHint && (!canRegenerateAssistant || canRegenerateAssistant(i, m));
          const hasControls = onPinAnchor || onUnpinAnchor || editEnabled || deleteEnabled || regenEnabled || regenWithHintEnabled;
          return (
            <div
              key={i}
              className={clsx(
                'group relative mb-6',
                pinned && 'before:absolute before:-left-3 before:top-2 before:bottom-2 before:w-[2px] before:bg-gold/60',
              )}
            >
              {i > 0 && (
                <div className="my-6 flex items-center gap-2 text-[10px] tracking-[0.3em] text-parchment-200/40 font-serif uppercase" style={{ textIndent: 0 }}>
                  <span aria-hidden className="flex-1 h-px bg-gold-line opacity-60 origin-left animate-line-in" />
                  <span className="shrink-0 italic">第 {m.round} 回</span>
                  <span aria-hidden className="flex-1 h-px bg-gold-line opacity-60 origin-right animate-line-in" />
                </div>
              )}

              {editing ? (
                <AssistantEditor
                  value={editingText}
                  onChange={setEditingText}
                  onCancel={() => { setEditingIndex(undefined); setEditingText(''); }}
                  onSave={() => saveEdit(i, m)}
                />
              ) : (
                <>
                  <ThinkToggle content={m.thinking} />
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {m.content}
                  </ReactMarkdown>
                </>
              )}

              {hinting && (
                <div className="mt-3 rounded-md border border-gold/40 bg-parchment-900/50 p-3 shadow-glow-sm" style={{ textIndent: 0 }}>
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
                    <ToolbarBtn onClick={() => { setHintIndex(undefined); setHintText(''); }}>
                      <X size={12} className="inline mr-1" />取消
                    </ToolbarBtn>
                    <ToolbarBtn
                      onClick={() => {
                        onRegenerateAssistantWithHint?.(i, m, hintText);
                        setHintIndex(undefined);
                        setHintText('');
                      }}
                      disabled={!hintText.trim()}
                      tone="gold"
                    >
                      <Sparkles size={12} className="inline mr-1" />确认重写
                    </ToolbarBtn>
                  </div>
                </div>
              )}

              {hasControls && !editing && !hinting && (
                <FloatingToolbar visible={!!pinned} align="left">
                  {(onPinAnchor || onUnpinAnchor) && (
                    <ToolbarIcon
                      onClick={() => (pinned ? onUnpinAnchor?.(pinned.id) : onPinAnchor?.(m))}
                      title={pinned ? '取消记忆锚点' : '标记为记忆锚点（模型会在后续叙事中呼应）'}
                      active={!!pinned}
                    >
                      {pinned ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                    </ToolbarIcon>
                  )}
                  {editEnabled && (
                    <ToolbarIcon
                      onClick={() => { setEditingIndex(i); setEditingText(m.content); }}
                      title="编辑这次模型回复，并按新文本重新生成后续选项"
                    >
                      <Pencil size={14} />
                    </ToolbarIcon>
                  )}
                  {deleteEnabled && (
                    <ToolbarIcon onClick={() => onDeleteMessage?.(i, m)} title="删除这条记录">
                      <Trash2 size={14} />
                    </ToolbarIcon>
                  )}
                  {regenEnabled && (
                    <ToolbarIcon onClick={() => onRegenerateAssistant?.(i, m)} title="直接重新请求这次模型回复">
                      <RotateCw size={14} />
                    </ToolbarIcon>
                  )}
                  {regenWithHintEnabled && (
                    <ToolbarIcon
                      onClick={() => { setHintIndex(i); setHintText(''); }}
                      title="增强重新请求：附加重要参考提示词"
                    >
                      <Sparkles size={14} />
                    </ToolbarIcon>
                  )}
                </FloatingToolbar>
              )}
            </div>
          );
        }

        if (m.role === 'user') {
          const hasControls = modifyEnabled || deleteEnabled;
          return (
            <div key={i} className="group relative my-4" style={{ textIndent: 0 }}>
              {editing ? (
                <div className="w-full max-w-[88%] rounded-md border border-gold/45 bg-parchment-900/55 p-3 shadow-glow-sm not-italic">
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    className="w-full min-h-[90px] resize-y rounded-md border border-parchment-600/50 bg-ink/40 px-3 py-2 font-serif text-sm leading-relaxed text-parchment-50 outline-none focus:border-gold/80"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <ToolbarBtn onClick={() => { setEditingIndex(undefined); setEditingText(''); }}>
                      <X size={12} className="inline mr-1" />取消
                    </ToolbarBtn>
                    <ToolbarBtn onClick={() => saveEdit(i, m)} disabled={!editingText.trim()} tone="gold">
                      <Check size={12} className="inline mr-1" />保存
                    </ToolbarBtn>
                  </div>
                </div>
              ) : (
                <div className="w-full pl-3 border-l-2 border-gold/45 text-parchment-200/85 italic">
                  <span className="text-gold/60 mr-1">▸</span>
                  <span className="font-serif text-[15px] leading-relaxed">{m.content}</span>
                </div>
              )}
              {hasControls && !editing && (
                <FloatingToolbar visible={false} align="left">
                  {modifyEnabled && (
                    <ToolbarIcon
                      onClick={() => { setEditingIndex(i); setEditingText(m.content); }}
                      title="编辑这条玩家行动/决策记录"
                    >
                      <Pencil size={14} />
                    </ToolbarIcon>
                  )}
                  {deleteEnabled && (
                    <ToolbarIcon onClick={() => onDeleteMessage?.(i, m)} title="删除这条记录">
                      <Trash2 size={14} />
                    </ToolbarIcon>
                  )}
                </FloatingToolbar>
              )}
            </div>
          );
        }
        return null;
      })}

      {(streaming || streamingThinking) && (
        <div className="mb-4">
          {history.length > 0 && (
            <div className="my-6 flex items-center gap-2 text-[10px] tracking-[0.3em] text-parchment-200/40 font-serif uppercase" style={{ textIndent: 0 }}>
              <span aria-hidden className="flex-1 h-px bg-gold-line opacity-60 origin-left animate-line-in" />
              <span className="shrink-0 italic">第 {streamingRoundLabel} 回</span>
              <span aria-hidden className="flex-1 h-px bg-gold-line opacity-60 origin-right animate-line-in" />
            </div>
          )}
          <div className="caret">
            <ThinkToggle content={streamingThinking} />
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {streaming || ''}
            </ReactMarkdown>
          </div>
        </div>
      )}
      <div ref={endRef} className="h-20" />
    </div>
  );
}

function AssistantEditor({
  value,
  onChange,
  onCancel,
  onSave,
}: {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-md border border-gold/45 bg-parchment-900/50 p-3 shadow-glow-sm" style={{ textIndent: 0 }}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-h-[220px] resize-y rounded-md border border-parchment-600/50 bg-ink/40 px-3 py-2 font-serif text-sm leading-relaxed text-parchment-50 outline-none focus:border-gold/80"
      />
      <div className="mt-2 flex justify-end gap-2">
        <ToolbarBtn onClick={onCancel}>
          <X size={12} className="inline mr-1" />取消
        </ToolbarBtn>
        <ToolbarBtn onClick={onSave} disabled={!value.trim()} tone="gold">
          <Check size={12} className="inline mr-1" />保存
        </ToolbarBtn>
      </div>
    </div>
  );
}

function FloatingToolbar({
  children,
  visible,
  align,
}: {
  children: React.ReactNode;
  visible: boolean;
  align: 'left' | 'right';
}) {
  return (
    <div
      className={clsx(
        'absolute top-0 z-10 flex flex-col gap-0.5 transition-opacity duration-200',
        align === 'left' ? '-left-8' : '-right-8',
        visible
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
      )}
      style={{ textIndent: 0 }}
    >
      {children}
    </div>
  );
}

function ToolbarIcon({
  children,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={clsx(
        'inline-flex h-7 w-7 items-center justify-center rounded text-parchment-200/65 transition-all duration-200',
        'hover:text-gold-light hover:bg-parchment-700/60',
        active && 'text-gold-light',
        'disabled:opacity-30 disabled:cursor-not-allowed',
      )}
    >
      {children}
    </button>
  );
}

function ToolbarBtn({
  children,
  tone = 'normal',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'normal' | 'gold' }) {
  return (
    <button
      type="button"
      {...props}
      className={clsx(
        'rounded border px-2 py-1 text-xs font-serif transition-all duration-200',
        tone === 'gold'
          ? 'border-gold/60 text-gold-light hover:bg-gold/10'
          : 'border-parchment-600/50 text-parchment-200/85 hover:border-gold/55 hover:text-gold-light',
        'disabled:opacity-40 disabled:cursor-not-allowed',
      )}
    >
      {children}
    </button>
  );
}
