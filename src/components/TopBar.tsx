import React from 'react';
import { Download, Flag, Home, MoreVertical, Package, Settings } from 'lucide-react';
import { clsx } from '@/lib/utils';
import { Button } from './ui/Button';
import { DropdownMenu, type DropdownMenuItem } from './ui/DropdownMenu';
import { RoundProgress } from './RoundProgress';

interface TopBarProps {
  saveName: string;
  currentRound: number;
  totalRounds: number;
  backpackCount: number;
  isInfiniteMode: boolean;
  finalizeRequested: boolean;
  isEnded: boolean;
  onHome: () => void;
  onSettings: () => void;
  onOpenBackpack: () => void;
  onExportChat: () => void;
  onExportJourney: () => void;
  onToggleFinalize: () => void;
}

/**
 * GamePage 顶部工具栏：左 Home，中 RoundProgress，右 旅程名 + 菜单。
 * 把原来一字排开的 5-7 个按钮收纳到右侧 ⋮ 下拉。
 */
export function TopBar({
  saveName,
  currentRound,
  totalRounds,
  backpackCount,
  isInfiniteMode,
  finalizeRequested,
  isEnded,
  onHome,
  onSettings,
  onOpenBackpack,
  onExportChat,
  onExportJourney,
  onToggleFinalize,
}: TopBarProps) {
  const menuItems: DropdownMenuItem[] = [];
  if (isInfiniteMode && !isEnded) {
    menuItems.push({
      id: 'finalize',
      label: finalizeRequested ? '取消完结' : '完结旅程',
      icon: <Flag size={14} className={finalizeRequested ? 'text-gold-light' : undefined} />,
      tone: finalizeRequested ? 'gold' : 'normal',
      onClick: onToggleFinalize,
    });
  }
  menuItems.push(
    {
      id: 'backpack',
      label: '查看背包',
      icon: <Package size={14} />,
      badge: backpackCount,
      onClick: onOpenBackpack,
    },
    {
      id: 'export-chat',
      label: '导出聊天记录',
      icon: <Download size={14} />,
      onClick: onExportChat,
    },
    {
      id: 'export-journey',
      label: '导出旅程包',
      icon: <Download size={14} />,
      onClick: onExportJourney,
    },
    {
      id: 'settings',
      label: '设置',
      icon: <Settings size={14} />,
      onClick: onSettings,
    },
  );

  return (
    <div className="sticky top-0 z-20">
      <div
        className={clsx(
          'relative bg-parchment-800/85 backdrop-blur-md',
          'shadow-[0_2px_18px_rgba(0,0,0,0.45)]',
        )}
      >
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3 h-16">
          {/* 左：Home */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onHome}
            className="!h-10 !w-10 !px-0 rounded-full"
            title="返回主页"
          >
            <Home size={16} />
          </Button>

          {/* 中：进度条 */}
          <div className="flex-1 max-w-3xl">
            <RoundProgress current={currentRound} total={totalRounds} />
          </div>

          {/* 右：旅程名 + 菜单 */}
          <div className="hidden md:block max-w-[180px] truncate font-serif text-sm tracking-[0.06em] text-parchment-100/80">
            {saveName}
          </div>
          <DropdownMenu
            align="right"
            items={menuItems}
            trigger={
              <span
                className={clsx(
                  'inline-flex h-10 w-10 items-center justify-center rounded-full',
                  'border border-parchment-500/40 hover:border-gold/65',
                )}
                title="更多操作"
              >
                <MoreVertical size={16} />
              </span>
            }
          />
        </div>
        {/* 底部金线分隔（较弱） */}
        <div className="pointer-events-none absolute inset-x-6 bottom-0 h-px bg-gold-line-dim opacity-60" />
      </div>
    </div>
  );
}
