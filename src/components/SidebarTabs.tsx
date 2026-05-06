import React, { useEffect, useState } from 'react';
import { Brain, Compass, ScrollText, ShieldCheck, UserRound } from 'lucide-react';
import { clsx } from '@/lib/utils';

export type SidebarTabId = 'character' | 'narrative' | 'guard' | 'world' | 'thoughts';

export interface SidebarTab {
  id: SidebarTabId;
  label: string;
  icon: React.ReactNode;
  /** 是否对当前存档可见（如：仅执笔模式才显示某些 tab） */
  available: boolean;
  /** 右上角小数字标记（可选，例如 NPC 数量 / 风险数） */
  badge?: number | string;
  content: React.ReactNode;
}

interface SidebarTabsProps {
  tabs: SidebarTab[];
  storageKey?: string;
}

const TAB_ICONS: Record<SidebarTabId, React.ReactNode> = {
  character: <UserRound size={14} />,
  narrative: <ScrollText size={14} />,
  guard: <ShieldCheck size={14} />,
  world: <Compass size={14} />,
  thoughts: <Brain size={14} />,
};

/**
 * 侧栏 tab 容器。把原来 8-9 个堆叠的面板按主题归并到 5 个 tab。
 *
 * - 选中态：tab 下方一条金线（动画从左到右画出）
 * - tab 切换：内容区 fade 过渡
 * - 选中 id 持久化到 localStorage（默认 key 'lrpg.ui.sidebarTab'）
 * - 不可见的 tab 自动 fallback 到第一个可见 tab
 */
export function SidebarTabs({ tabs, storageKey = 'lrpg.ui.sidebarTab' }: SidebarTabsProps) {
  const visible = tabs.filter((t) => t.available);
  const firstId = visible[0]?.id;

  const [active, setActive] = useState<SidebarTabId | undefined>(() => {
    if (typeof window === 'undefined') return firstId;
    try {
      const saved = window.localStorage.getItem(storageKey) as SidebarTabId | null;
      if (saved && visible.some((t) => t.id === saved)) return saved;
    } catch {
      /* noop */
    }
    return firstId;
  });

  // 当前 active tab 不再可见（例如切换出执笔模式）→ fallback 到第一个
  useEffect(() => {
    if (!active || !visible.some((t) => t.id === active)) {
      setActive(firstId);
    }
  }, [active, firstId, visible]);

  // 持久化
  useEffect(() => {
    if (!active) return;
    try {
      window.localStorage.setItem(storageKey, active);
    } catch {
      /* noop */
    }
  }, [active, storageKey]);

  if (!visible.length || !active) return null;
  const current = visible.find((t) => t.id === active) ?? visible[0];

  return (
    <div className="flex flex-col h-full">
      {/* tab 头 */}
      <div className="flex items-stretch gap-px overflow-x-auto rounded-md border border-parchment-600/45 bg-ink/60 p-1 backdrop-blur-md">
        {visible.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={clsx(
                'relative flex-1 flex items-center justify-center gap-1.5 rounded px-2 py-2',
                'font-serif text-xs tracking-[0.18em] transition-all duration-300 ease-out-expo',
                'whitespace-nowrap',
                isActive
                  ? 'tab-active-underline text-gold-light bg-parchment-800/70'
                  : 'text-parchment-200/60 hover:text-gold-light hover:bg-parchment-700/30',
              )}
              aria-pressed={isActive}
            >
              <span className="shrink-0">{tab.icon ?? TAB_ICONS[tab.id]}</span>
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge !== 0 && (
                <span
                  className={clsx(
                    'ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] tracking-normal font-sans tabular-nums',
                    isActive
                      ? 'bg-gold/20 text-gold-light border border-gold/45'
                      : 'bg-parchment-900/60 text-parchment-200/65 border border-parchment-600/45',
                  )}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 内容区 —— 用 key 强制重渲染触发 fade-in */}
      <div className="mt-3 flex-1 min-h-0 overflow-y-auto pr-1">
        <div key={current.id} className="animate-fade-in flex flex-col gap-4">
          {current.content}
        </div>
      </div>
    </div>
  );
}
