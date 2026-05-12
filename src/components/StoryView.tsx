import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentThought, Message, MemoryAnchor, ToolActivityRecord } from '@/types/game';
import type { LlmUsage } from '@/types/llm';
import { GoldLine } from './ui/GoldLine';
import { Bookmark, BookmarkCheck, Check, ChevronRight, Pencil, RotateCw, Sparkles, Trash2, X } from 'lucide-react';
import { clsx } from '@/lib/utils';
import { ThinkToggle } from '@/components/ThinkToggle';

interface StoryViewProps {
  history: Message[];
  streaming?: string;
  streamingThinking?: string;
  streamingAgentOutput?: string;
  streamingToolEvents?: ToolActivityRecord[];
  agentBusy?: string | null;
  agentBusyLabel?: string;
  runtimeRoundStartedAt?: number;
  runtimeAgentStartedAt?: number;
  runtimeTotalUsage?: LlmUsage;
  runtimeEstimatedOutputTokens?: number;
  agentThoughts?: AgentThought[];
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
  streamingAgentOutput,
  streamingToolEvents,
  agentBusy,
  agentBusyLabel,
  runtimeRoundStartedAt,
  runtimeAgentStartedAt,
  runtimeTotalUsage,
  runtimeEstimatedOutputTokens,
  agentThoughts,
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
  const [now, setNow] = useState(() => Date.now());
  const autoScrollRef = useRef(true);
  const lastScrollYRef = useRef(typeof window !== 'undefined' ? window.scrollY : 0);

  const anchorByRound = new Map<number, MemoryAnchor>();
  for (const a of anchors ?? []) {
    if (!anchorByRound.has(a.round)) anchorByRound.set(a.round, a);
  }
  const thoughtsByRound = new Map<number, AgentThought[]>();
  for (const item of agentThoughts ?? []) {
    const list = thoughtsByRound.get(item.round) ?? [];
    list.push(item);
    thoughtsByRound.set(item.round, list);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const getBottomDistance = () => {
      const doc = document.documentElement;
      return Math.max(0, doc.scrollHeight - (window.scrollY + window.innerHeight));
    };
    const isNearBottom = () => getBottomDistance() < 180;

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < -2) {
        autoScrollRef.current = false;
      } else if (isNearBottom()) {
        autoScrollRef.current = true;
      }
    };

    const onScroll = () => {
      const y = window.scrollY;
      if (isNearBottom()) {
        autoScrollRef.current = true;
      } else if (y < lastScrollYRef.current - 2) {
        autoScrollRef.current = false;
      }
      lastScrollYRef.current = y;
    };

    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('touchmove', onScroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('touchmove', onScroll);
    };
  }, []);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history.length, streaming, streamingThinking, streamingAgentOutput, phase]);

  useEffect(() => {
    if (!runtimeAgentStartedAt && !runtimeRoundStartedAt) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [runtimeAgentStartedAt, runtimeRoundStartedAt]);

  const saveEdit = (index: number, msg: Message) => {
    if (onEditMessage) onEditMessage(index, msg, editingText);
    else if (msg.role === 'assistant') onEditAssistant?.(index, msg, editingText);
    setEditingIndex(undefined);
    setEditingText('');
  };

  const streamingRoundLabel = (() => {
    if (history.length === 0) return 0;
    const last = history[history.length - 1];
    if (last.role !== 'assistant') return last.round;
    // 故事正文落库后，决策/导演/审校等后处理仍属于刚完成的这一回。
    // 旧逻辑直接 assistant.round + 1，会让第一回合的模型链路在故事完成后跳成第二回合。
    if (agentBusy && agentBusy !== 'story') return Math.max(1, last.round);
    return last.round + 1;
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
                  <RoundRecordsToggle
                    events={m.toolEvents}
                    thoughts={thoughtsByRound.get(m.round)}
                    runtimeStats={m.runtimeStats}
                  />
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

      {Boolean(streaming || streamingThinking || streamingAgentOutput || (streamingToolEvents?.length ?? 0) > 0) && (
        <div className="mb-4">
          {history.length > 0 && (
            <div className="my-6 flex items-center gap-2 text-[10px] tracking-[0.3em] text-parchment-200/40 font-serif uppercase" style={{ textIndent: 0 }}>
              <span aria-hidden className="flex-1 h-px bg-gold-line opacity-60 origin-left animate-line-in" />
              <span className="shrink-0 italic">第 {streamingRoundLabel} 回</span>
              <span aria-hidden className="flex-1 h-px bg-gold-line opacity-60 origin-right animate-line-in" />
            </div>
          )}
          <div className="caret">
            <AgentFlowTree
              events={streamingToolEvents}
              agentBusy={agentBusy}
              agentBusyLabel={agentBusyLabel}
              variant="streaming"
            />
            <RuntimeProgressMeta
              now={now}
              agentStartedAt={runtimeAgentStartedAt}
              roundStartedAt={runtimeRoundStartedAt}
              usage={runtimeTotalUsage}
              completedOutputTokens={runtimeEstimatedOutputTokens}
              liveOutputText={`${streamingThinking || ''}${streamingAgentOutput || ''}${streaming || ''}`}
            />
            <ThinkToggle
              content={streamingThinking}
              label={agentBusyLabel ? `${agentBusyLabel} think` : 'think'}
              defaultOpen
            />
            <ThinkToggle
              content={streamingAgentOutput}
              label={agentBusy === 'story' ? 'output' : 'json'}
              title="显示/隐藏当前模型输出预览"
              defaultOpen={agentBusy !== 'story'}
              autoJson
            />
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

function formatDuration(ms: number | undefined): string | undefined {
  const value = Math.max(0, Math.floor(Number(ms) || 0));
  if (!value) return undefined;
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatTokenCount(value: number | undefined): string | undefined {
  const n = Math.max(0, Math.round(Number(value) || 0));
  if (!n) return undefined;
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? k.toFixed(1) : k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

function estimateOutputTokens(text: string): number {
  let cjk = 0;
  let ascii = 0;
  let other = 0;
  for (const ch of String(text ?? '')) {
    const code = ch.charCodeAt(0);
    if (
      (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0x3400 && code <= 0x4dbf)
      || (code >= 0x3000 && code <= 0x303f)
      || (code >= 0xff00 && code <= 0xffef)
    ) cjk += 1;
    else if (code <= 0x007f) ascii += 1;
    else other += 1;
  }
  return Math.max(0, Math.round(cjk * 0.65 + ascii * 0.28 + other * 0.6));
}

function totalUsageTokens(usage: LlmUsage | undefined): number | undefined {
  if (!usage) return undefined;
  if (usage.totalTokens && usage.totalTokens > 0) return usage.totalTokens;
  const total = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  return total > 0 ? total : undefined;
}

function RuntimeProgressMeta({
  now,
  agentStartedAt,
  usage,
  completedOutputTokens,
  liveOutputText,
}: {
  now: number;
  agentStartedAt?: number;
  roundStartedAt?: number;
  usage?: LlmUsage;
  completedOutputTokens?: number;
  liveOutputText: string;
}) {
  if (!agentStartedAt) return null;
  const elapsed = now - agentStartedAt;
  if (elapsed < 15000) return null;
  const duration = formatDuration(elapsed);
  const liveTokens = estimateOutputTokens(liveOutputText);
  const tokenText = formatTokenCount(liveTokens);
  if (!duration && !tokenText) return null;

  const totalTokens = formatTokenCount(totalUsageTokens(usage));
  return (
    <div
      className="not-prose mb-2 inline-flex items-center rounded-full border border-gold/25 bg-parchment-900/35 px-2.5 py-0.5 font-mono text-[10px] text-parchment-200/60"
      title={totalTokens ? `当前模型输出 token 为流式估算值；本流程已完成调用总 token：${totalTokens}` : '当前模型输出 token 为流式估算值'}
      style={{ textIndent: 0 }}
    >
      （{duration}{tokenText ? ` · ↓ ${tokenText} tokens` : ''}）
    </div>
  );
}

// =========================================================
// 模型链路可视化：嵌套折叠树 + 单行总结
// =========================================================

type AgentNodeStatus = 'running' | 'completed' | 'failed' | 'cancelled';
type AgentChildStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface AgentChild {
  id: string;
  name: string;
  label: string;
  detail?: string;
  status: AgentChildStatus;
  startTime: number;
  endTime?: number;
}

interface AgentNode {
  id: string;
  actor: string;
  agentKind?: string;
  statusHint?: string;
  status: AgentNodeStatus;
  startTime: number;
  endTime?: number;
  children: AgentChild[];
}

const ERROR_RE = /^(error|err[:：]|failed|失败|exception)/i;

function buildAgentFlow(
  events: ToolActivityRecord[],
  opts: { agentBusy?: string | null; agentBusyLabel?: string; final?: boolean },
): AgentNode[] {
  const nodes: AgentNode[] = [];
  let current: AgentNode | null = null;

  for (const ev of events) {
    if (ev.actor === '_aborted') {
      const last = nodes[nodes.length - 1];
      if (last) {
        last.status = 'cancelled';
        for (const c of last.children) {
          if (c.status === 'running') c.status = 'cancelled';
        }
      }
      current = null;
      continue;
    }

    const actor = (ev.actor || '').trim() || '模型';
    if (!current || current.actor !== actor) {
      current = {
        id: `${ev.id}:node`,
        actor,
        agentKind: ev.agentKind,
        statusHint: undefined,
        status: 'running',
        startTime: ev.createdAt,
        children: [],
      };
      nodes.push(current);
    }
    if (!current.agentKind && ev.agentKind) current.agentKind = ev.agentKind;

    if (ev.phase === 'status') {
      if (!current.statusHint) current.statusHint = ev.label;
      continue;
    }

    if (ev.phase === 'call') {
      current.children.push({
        id: ev.id,
        name: ev.name,
        label: ev.label,
        detail: ev.detail,
        status: 'running',
        startTime: ev.createdAt,
      });
      continue;
    }

    if (ev.phase === 'result') {
      const isError = ERROR_RE.test(String(ev.detail || ev.label || '').slice(0, 64));
      let matched = false;
      for (let i = current.children.length - 1; i >= 0; i--) {
        const c = current.children[i];
        if (c.name === ev.name && c.status === 'running') {
          c.status = isError ? 'failed' : 'completed';
          c.endTime = ev.createdAt;
          if (ev.detail) c.detail = ev.detail;
          matched = true;
          break;
        }
      }
      if (!matched) {
        current.children.push({
          id: ev.id,
          name: ev.name,
          label: ev.label,
          detail: ev.detail,
          status: isError ? 'failed' : 'completed',
          startTime: ev.createdAt,
          endTime: ev.createdAt,
        });
      }
      continue;
    }

    // phase === 'read' | 'write' | undefined → 单条独立 child（已完成）
    const isError = ERROR_RE.test(String(ev.detail || ev.label || '').slice(0, 64));
    current.children.push({
      id: ev.id,
      name: ev.name,
      label: ev.label,
      detail: ev.detail,
      status: isError ? 'failed' : 'completed',
      startTime: ev.createdAt,
      endTime: ev.createdAt,
    });
  }

  // 司辰特殊处理：合并空"回合司辰"前导 header 到紧随的 '司辰·*' 子父节点
  for (let i = 0; i < nodes.length - 1; i++) {
    const n = nodes[i];
    const next = nodes[i + 1];
    if (
      n.actor === '回合司辰' &&
      n.children.length === 0 &&
      next.actor.startsWith('司辰·')
    ) {
      if (!next.statusHint && n.statusHint) next.statusHint = n.statusHint;
      if (!next.agentKind && n.agentKind) next.agentKind = n.agentKind;
      nodes.splice(i, 1);
      i--;
    }
  }

  // 父节点状态推断
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.status === 'cancelled') continue;
    const isLast = i === nodes.length - 1;
    if (!isLast) {
      node.status = 'completed';
      continue;
    }
    // 最后一个节点
    if (opts.final) {
      node.status = 'completed';
      continue;
    }
    if (isRunningActor(node, opts.agentBusy, opts.agentBusyLabel)) {
      node.status = 'running';
    } else {
      node.status = 'completed';
    }
  }

  return nodes;
}

function isRunningActor(node: AgentNode, agentBusy?: string | null, agentBusyLabel?: string): boolean {
  if (!agentBusy && !agentBusyLabel) return false;
  if (agentBusy && node.agentKind && node.agentKind === agentBusy) return true;
  if (agentBusyLabel && node.actor === agentBusyLabel) return true;
  if (agentBusy === 'orchestrator' && node.actor.startsWith('司辰·')) return true;
  return false;
}

function useAgentFlowTree(
  events: ToolActivityRecord[] | undefined,
  opts: { agentBusy?: string | null; agentBusyLabel?: string; final?: boolean } = {},
): AgentNode[] {
  return useMemo(
    () => buildAgentFlow(events ?? [], opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, opts.agentBusy, opts.agentBusyLabel, opts.final],
  );
}

// ----- 进行中嵌套树 -----

interface AgentFlowTreeProps {
  events?: ToolActivityRecord[];
  agentBusy?: string | null;
  agentBusyLabel?: string;
  variant?: 'streaming' | 'history';
}

function AgentFlowTree({ events, agentBusy, agentBusyLabel, variant = 'streaming' }: AgentFlowTreeProps) {
  const final = variant === 'history';
  const nodes = useAgentFlowTree(events, { agentBusy, agentBusyLabel, final });

  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  // 新节点默认开闭：running → 开；其它 → 关。
  useEffect(() => {
    setOpenMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const n of nodes) {
        if (variant === 'streaming') {
          const shouldOpen = n.status === 'running';
          if (next[n.id] !== shouldOpen) {
            next[n.id] = shouldOpen;
            changed = true;
          }
          continue;
        }
        if (next[n.id] === undefined) {
          next[n.id] = n.status === 'running';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [nodes, variant]);

  if (!nodes.length) return null;

  return (
    <div
      className="not-prose mb-3 rounded-md border border-gold/20 bg-parchment-900/20 p-2 space-y-1"
      style={{ textIndent: 0 }}
    >
      {nodes.map((node) => (
        <AgentFlowNodeView
          key={node.id}
          node={node}
          open={openMap[node.id] ?? (node.status === 'running')}
          onToggle={() =>
            setOpenMap((p) => ({
              ...p,
              [node.id]: !(p[node.id] ?? node.status === 'running'),
            }))
          }
        />
      ))}
    </div>
  );
}

function AgentFlowNodeView({
  node,
  open,
  onToggle,
}: {
  node: AgentNode;
  open: boolean;
  onToggle: () => void;
}) {
  const running = node.status === 'running';
  const cancelled = node.status === 'cancelled';
  const failed = node.status === 'failed';
  const hasChildren = node.children.length > 0;

  return (
    <div
      className={clsx(
        'rounded-sm transition-all duration-200 animate-fade-in',
        running && 'bg-gold/[0.04] shadow-glow-sm',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-1.5 py-1 text-left"
      >
        <ChevronRight
          size={11}
          className={clsx(
            'shrink-0 transition-transform duration-200 ease-out-expo',
            running ? 'text-gold/85' : 'text-gold/45',
            open && 'rotate-90',
          )}
        />
        <span
          className={clsx(
            'shrink-0 font-serif text-[12px] tracking-wider',
            running && 'text-gold-light animate-pulse-soft',
            cancelled && 'text-parchment-200/45',
            failed && 'text-blood/85',
            !running && !cancelled && !failed && 'text-gold-light/80',
          )}
        >
          {node.actor}
        </span>
        {node.statusHint && (
          <span className="min-w-0 truncate text-[11px] font-serif text-parchment-200/55">
            · {node.statusHint}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {hasChildren && (
            <span className="text-[10px] font-serif text-parchment-200/40 tabular-nums">
              {node.children.length}
            </span>
          )}
          <NodeStatusBadge status={node.status} />
        </span>
      </button>
      <div
        className={clsx(
          'grid transition-all duration-300 ease-out-quart',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          {hasChildren && (
            <div className="ml-3 mt-0.5 mb-1 border-l border-gold/15 pl-3 space-y-0.5">
              {node.children.map((c) => (
                <AgentFlowChildView key={c.id} child={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentFlowChildView({ child }: { child: AgentChild }) {
  return (
    <div
      className="flex items-start gap-2 py-0.5 animate-fade-in"
      title={child.detail || child.label}
    >
      <span className="mt-0.5 shrink-0 text-gold/45 text-[10px]">✦</span>
      <span
        className={clsx(
          'min-w-0 flex-1 truncate text-[12px] font-serif',
          child.status === 'failed' && 'text-blood/85',
          child.status === 'cancelled' && 'text-parchment-200/45',
          (child.status === 'running' || child.status === 'completed') && 'text-parchment-200/80',
        )}
      >
        {child.label}
      </span>
      <span className="shrink-0 mt-0.5">
        <ChildStatusBadge status={child.status} />
      </span>
    </div>
  );
}

function NodeStatusBadge({ status }: { status: AgentNodeStatus }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-serif tracking-widest text-gold-light/85">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-light animate-pulse-soft" />
        进行中
      </span>
    );
  }
  if (status === 'failed') {
    return <span className="text-[10px] font-serif text-blood/85">失败</span>;
  }
  if (status === 'cancelled') {
    return <span className="text-[10px] font-serif text-parchment-200/45">已取消</span>;
  }
  return <span className="text-[10px] font-serif text-gold/55">已完成</span>;
}

function ChildStatusBadge({ status }: { status: AgentChildStatus }) {
  if (status === 'running') {
    return <span className="text-[10px] font-serif text-gold-light/75 animate-pulse-soft tracking-widest">···</span>;
  }
  if (status === 'failed') {
    return <span className="text-[10px] font-serif text-blood/85">失败</span>;
  }
  if (status === 'cancelled') {
    return <span className="text-[10px] font-serif text-parchment-200/45">取消</span>;
  }
  return <Check size={11} className="text-moss-light/70" />;
}

// ----- 历史卡单行总结 -----

function shortActor(actor: string): string {
  if (actor.length <= 8) return actor;
  return `${actor.slice(0, 7)}…`;
}

function AgentFlowSummary({
  events,
  runtimeStats,
  expanded,
  onToggle,
}: {
  events: ToolActivityRecord[];
  runtimeStats?: Message['runtimeStats'];
  expanded: boolean;
  onToggle: () => void;
}) {
  const nodes = useAgentFlowTree(events, { final: true });
  const stepCount = nodes.length;
  const toolCount = nodes.reduce((acc, n) => acc + n.children.length, 0);

  const chain = (() => {
    if (nodes.length === 0) return [];
    if (nodes.length <= 6) return nodes.map((n) => shortActor(n.actor));
    return [
      ...nodes.slice(0, 3).map((n) => shortActor(n.actor)),
      '…',
      ...nodes.slice(-2).map((n) => shortActor(n.actor)),
    ];
  })();
  const elapsed = formatDuration(runtimeStats?.elapsedMs);
  const totalTokens = formatTokenCount(totalUsageTokens(runtimeStats?.usage) ?? runtimeStats?.estimatedOutputTokens);

  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-serif text-[11px] transition-colors',
        expanded
          ? 'border-gold/45 bg-gold/10 text-gold-light'
          : 'border-parchment-600/35 bg-parchment-900/30 text-parchment-200/55 hover:border-gold/40 hover:text-gold-light',
      )}
      title={expanded ? '收起本回合模型链路' : '展开本回合模型链路'}
    >
      <span className="text-gold/65">✦</span>
      <span className="min-w-0 truncate max-w-[480px]">{chain.join(' → ')}</span>
      <span className="shrink-0 whitespace-nowrap text-parchment-200/40 tabular-nums">
        {stepCount} 步 · {toolCount} 工具
      </span>
      {(elapsed || totalTokens) && (
        <span
          className="shrink-0 whitespace-nowrap rounded-full border border-gold/20 bg-ink/25 px-1.5 py-px font-mono text-[10px] text-gold/65"
          title="本回合模型调用总耗时 / 总 token 消耗"
        >
          {elapsed}{totalTokens ? ` · ${totalTokens} tokens` : ''}
        </span>
      )}
      <ChevronRight
        size={11}
        className={clsx('shrink-0 transition-transform duration-200', expanded && 'rotate-90')}
      />
    </button>
  );
}

// =========================================================
// 工具名映射（兜底用，主路径已在 GamePage 处拼好 label）
// =========================================================

function toolNameLabel(name: string): string {
  switch (name) {
    case 'read_doc': return '阅读了司书库文件';
    case 'search_docs': return '检索了司书库';
    case 'list_docs': return '查看了司书库目录';
    case 'get_story_briefing': return '查阅了故事资料包';
    case 'get_story_outline': return '查阅了完整故事大纲';
    case 'get_initial_scene': return '查阅了开局文本';
    case 'get_background': return '查阅了主角出身';
    case 'get_world_books': return '查阅了世界书';
    case 'get_journey_content': return '查阅了旅程配置';
    case 'get_author_custom_config': return '查阅了自定义规则';
    case 'get_story_style': return '查阅了故事风格';
    case 'get_recent_rounds': return '查阅了近期卷宗';
    case 'get_recent_history': return '查阅了最近对话';
    case 'get_round_record': return '查阅了指定回合卷宗';
    case 'get_current_state': return '查看了当前旅程状态';
    case 'get_master_arc': return '查阅了主弧';
    case 'get_director_plan': return '查阅了导演计划';
    case 'get_active_events': return '查阅了进行中的事件';
    case 'get_active_arcs': return '查阅了进行中的事件弧';
    case 'get_current_round_agent_calls': return '查看了本回合模型记录';
    case 'get_recent_agent_calls': return '查看了近期模型记录';
    case 'get_agent_output': return '查阅了模型输出';
    case 'get_latest_planning_bundle': return '查阅了最新规划包';
    case 'get_npc_list': return '查阅了 NPC 列表';
    case 'get_npc_detail': return '查阅了 NPC 档案';
    case 'run_character_analysis': return '询问人物规划员';
    case 'run_scene_analysis': return '询问场景规划员';
    case 'run_event_analysis': return '询问事件规划员';
    case 'set_npc_affinity': return '调整了 NPC 好感';
    case 'add_npc_note': return '给 NPC 加了备注';
    case 'grant_minor_item': return '授予了事件能力';
    case 'update_item_note': return '更新了能力备注';
    case 'write_doc': return '写入了司书库文件';
    case 'patch_doc': return '更新了司书库文件';
    case 'append_doc': return '补充了司书库文件';
    case 'archive_doc': return '归档了司书库文件';
    case 'write_entity_doc': return '写入了实体档案';
    default: return `调用工具 ${name}`;
  }
}

function extractToolEventsFromThought(thought: AgentThought): ToolActivityRecord[] {
  const messages = thought.prompt?.messages ?? [];
  const out: ToolActivityRecord[] = [];
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const match = message.content.match(/^\[tool:([^\]]+)\]/);
    const name = match?.[1]?.trim() || 'tool';
    out.push({
      id: `${thought.id}:${out.length}`,
      name,
      label: toolNameLabel(name),
      detail: `${thought.label}\n${message.content}`,
      actor: thought.label.split('·')[0]?.trim() || '模型',
      phase: ['write_doc', 'patch_doc', 'append_doc', 'archive_doc', 'write_entity_doc'].includes(name) ? 'write' : 'read',
      createdAt: thought.createdAt,
    });
  }
  return out;
}

// =========================================================
// 历史卡的记录抽屉
// =========================================================

function RoundRecordsToggle({
  events,
  thoughts,
  runtimeStats,
}: {
  events?: ToolActivityRecord[];
  thoughts?: AgentThought[];
  runtimeStats?: Message['runtimeStats'];
}) {
  const [open, setOpen] = useState(false);
  const visibleThoughts = useMemo(
    () => (thoughts ?? []).filter((item) => item.kind !== 'story'),
    [thoughts],
  );

  // 优先用 events（新链路），无 events 时从 thoughts 派生兜底事件，让旧存档也能用同一套 UI
  const fallbackEvents = useMemo<ToolActivityRecord[]>(() => {
    if (events?.length) return [];
    return visibleThoughts.flatMap(extractToolEventsFromThought);
  }, [events, visibleThoughts]);

  const summaryEvents = events?.length ? events : fallbackEvents;
  const hasSummary = summaryEvents.length > 0;
  const hasThoughts = visibleThoughts.length > 0;
  const hasRuntimeStats = !!(runtimeStats?.elapsedMs || runtimeStats?.usage || runtimeStats?.estimatedOutputTokens);

  if (!hasSummary && !hasThoughts && !hasRuntimeStats) return null;

  return (
    <div className="not-prose mb-3" style={{ textIndent: 0 }}>
      {hasSummary ? (
        <AgentFlowSummary
          events={summaryEvents}
          runtimeStats={runtimeStats}
          expanded={open}
          onToggle={() => setOpen((v) => !v)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={clsx(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-serif text-[11px] transition-colors',
            open
              ? 'border-gold/45 bg-gold/10 text-gold-light'
              : 'border-parchment-600/35 bg-parchment-900/25 text-parchment-200/45 hover:border-gold/40 hover:text-gold-light',
          )}
          title={open ? '隐藏本回合模型记录' : '展开本回合模型记录'}
        >
          ✦ 模型记录 {visibleThoughts.length}
          {hasRuntimeStats && (
            <span className="ml-1 font-mono text-[10px] text-gold/65">
              {formatDuration(runtimeStats?.elapsedMs)}
              {formatTokenCount(totalUsageTokens(runtimeStats?.usage) ?? runtimeStats?.estimatedOutputTokens)
                ? ` · ${formatTokenCount(totalUsageTokens(runtimeStats?.usage) ?? runtimeStats?.estimatedOutputTokens)} tokens`
                : ''}
            </span>
          )}
        </button>
      )}
      <div
        className={clsx(
          'grid transition-all duration-300 ease-out-quart',
          open ? 'mt-2 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          {hasSummary && <AgentFlowTree events={summaryEvents} variant="history" />}
          {hasThoughts && <ThoughtsList thoughts={visibleThoughts} />}
        </div>
      </div>
    </div>
  );
}

function ThoughtsList({ thoughts }: { thoughts: AgentThought[] }) {
  return (
    <div className="rounded-md border border-gold/15 bg-parchment-900/25 p-2 text-[11px] font-serif text-parchment-200/70 space-y-1">
      {thoughts.map((t) => {
        const head = t.label.split('·')[0]?.trim() || t.label;
        const tail = t.output?.trim();
        return (
          <div key={t.id} className="flex items-start gap-1.5">
            <span className="text-gold/55">·</span>
            <span className="min-w-0">
              <span className="text-gold-light/80">{head}</span>
              {!!tail && (
                <>
                  <br />
                  <span className="break-all text-parchment-200/55">
                    {tail.length > 160 ? `${tail.slice(0, 160)}…` : tail}
                  </span>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// =========================================================
// 通用 UI 子件
// =========================================================

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
