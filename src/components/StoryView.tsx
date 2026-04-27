import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, MemoryAnchor } from '@/types/game';
import { OrnateDivider } from './ui/Ornaments';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { clsx } from '@/lib/utils';

interface StoryViewProps {
  history: Message[];
  streaming?: string;   // 当前正在流式输出的文本（可选）
  phase: 'story' | 'choices' | 'manual' | 'ended';
  anchors?: MemoryAnchor[];
  onPinAnchor?: (msg: Message) => void;
  onUnpinAnchor?: (anchorId: string) => void;
}

const markdownComponents = {
  p: (props: any) => <p {...props} />,
  strong: (props: any) => <strong {...props} />,
  em: (props: any) => <em {...props} />,
  blockquote: (props: any) => <blockquote {...props} />,
};

export function StoryView({ history, streaming, phase, anchors, onPinAnchor, onUnpinAnchor }: StoryViewProps) {
  const endRef = useRef<HTMLDivElement>(null);

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
          return (
            <div key={i} className="mb-4 group relative">
              {i > 0 && <OrnateDivider>{`第 ${m.round} 回合`}</OrnateDivider>}
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {m.content}
              </ReactMarkdown>
              {(onPinAnchor || onUnpinAnchor) && (
                <button
                  type="button"
                  onClick={() => {
                    if (pinned) onUnpinAnchor?.(pinned.id);
                    else onPinAnchor?.(m);
                  }}
                  title={pinned ? '取消记忆锚点' : '标记为记忆锚点（模型会在后续叙事中呼应）'}
                  className={clsx(
                    'absolute -left-7 top-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded',
                    pinned ? 'opacity-100 text-gold-light' : 'text-parchment-200/50 hover:text-gold-light',
                  )}
                >
                  {pinned ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                </button>
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
