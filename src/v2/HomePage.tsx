import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Compass,
  PlayCircle,
  ScrollText,
  Settings,
  Trash2,
} from 'lucide-react';
import { TextStarfield } from '@/components/TextStarfield';
import { Button } from '@/components/ui/Button';
import { confirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog } from '@/components/ui/Dialog';
import { CornerFiligree, OrnateDivider } from '@/components/ui/Ornaments';
import { useGameStoreV2 } from './store';

// Keep this flag in module memory rather than component state. A full browser
// reload evaluates the module again and restores the entrance animation, while
// normal SPA navigation back to the home page keeps it disabled.
let hasPlayedHomeEntrance = false;

export default function HomePageV2() {
  const nav = useNavigate();
  const saves = useGameStoreV2((state) => state.saves);
  const setActive = useGameStoreV2((state) => state.setActive);
  const remove = useGameStoreV2((state) => state.remove);
  const [showSaves, setShowSaves] = useState(false);
  const playEntranceAnimation = !hasPlayedHomeEntrance;

  useEffect(() => {
    hasPlayedHomeEntrance = true;
  }, []);

  const saveList = Object.values(saves).sort((a, b) => b.updatedAt - a.updatedAt);
  const hasSaves = saveList.length > 0;

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-6 py-12">
      <TextStarfield
        autoImpulse={8}
        className={
          playEntranceAnimation
            ? 'animate-fade-in [animation-delay:300ms] [animation-duration:1100ms]'
            : undefined
        }
      />

      <div className="relative z-10 w-full max-w-3xl text-center">
        <CornerFiligree
          className={`absolute -left-6 -top-6 h-20 w-20${playEntranceAnimation ? ' animate-fade-in' : ''}`}
          style={playEntranceAnimation ? { animationDelay: '900ms' } : undefined}
        />
        <CornerFiligree
          className={`absolute -right-6 -top-6 h-20 w-20 rotate-90${playEntranceAnimation ? ' animate-fade-in' : ''}`}
          style={playEntranceAnimation ? { animationDelay: '980ms' } : undefined}
        />
        <CornerFiligree
          className={`absolute -bottom-6 -left-6 h-20 w-20 -rotate-90${playEntranceAnimation ? ' animate-fade-in' : ''}`}
          style={playEntranceAnimation ? { animationDelay: '980ms' } : undefined}
        />
        <CornerFiligree
          className={`absolute -bottom-6 -right-6 h-20 w-20 rotate-180${playEntranceAnimation ? ' animate-fade-in' : ''}`}
          style={playEntranceAnimation ? { animationDelay: '1060ms' } : undefined}
        />

        <div
          className={`mb-2 text-sm tracking-[0.8em] text-gold/70${playEntranceAnimation ? ' animate-fade-in' : ''}`}
          style={playEntranceAnimation ? { animationDelay: '1250ms' } : undefined}
        >
          LANGUAGE · RPG
        </div>
        <h1
          className={`title-engraved mb-3 font-serif text-6xl leading-none tracking-widest md:text-7xl${playEntranceAnimation ? ' animate-ink-bloom' : ''}`}
          style={playEntranceAnimation ? { animationDelay: '1370ms' } : undefined}
        >
          言 · 灵
        </h1>
        <div
          className={`mb-8 font-serif text-base text-parchment-200/70${playEntranceAnimation ? ' animate-fade-in' : ''}`}
          style={playEntranceAnimation ? { animationDelay: '1600ms' } : undefined}
        >
          由语言编织的世界，因你的抉择改变抵达命运的道路
        </div>

        <OrnateDivider
          enter={playEntranceAnimation}
          style={playEntranceAnimation ? { ['--enter-delay' as string]: '850ms' } : undefined}
        />

        <div
          className={`mx-auto mb-10 max-w-xl font-serif text-sm leading-loose text-parchment-200/80${playEntranceAnimation ? ' animate-fade-in' : ''}`}
          style={playEntranceAnimation ? { animationDelay: '1750ms' } : undefined}
        >
          选定一段命运与一种出身，和规划之镜、故事之笔一同前行。
          <br />
          你可以改变道路，而故事会记住方向，陪你完整走到预设的结尾。
        </div>

        <div className="flex flex-col items-center gap-3">
          <Button
            size="lg"
            onClick={() => nav('/setup')}
            className={`w-72${playEntranceAnimation ? ' animate-slide-up-in' : ''}`}
            style={playEntranceAnimation ? { animationDelay: '1900ms' } : undefined}
          >
            <ScrollText size={18} /> 启程 · 开始新旅程
          </Button>

          {hasSaves && (
            <Button
              size="lg"
              variant="outline"
              onClick={() => setShowSaves(true)}
              className={`w-72${playEntranceAnimation ? ' animate-slide-up-in' : ''}`}
              style={playEntranceAnimation ? { animationDelay: '2010ms' } : undefined}
            >
              <PlayCircle size={18} /> 继续旅程（{saveList.length}）
            </Button>
          )}

          <div
            className={`mt-4 flex gap-2${playEntranceAnimation ? ' animate-fade-in' : ''}`}
            style={
              playEntranceAnimation
                ? { animationDelay: hasSaves ? '2150ms' : '2040ms' }
                : undefined
            }
          >
            <Button variant="ghost" onClick={() => nav('/settings')}>
              <Settings size={16} /> 模型与连接设置
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={showSaves}
        onClose={() => setShowSaves(false)}
        title="选择要继续的旅程"
        widthClass="max-w-3xl"
      >
        <div className="flex flex-col gap-3">
          {saveList.map((save) => (
            <div
              key={save.id}
              className="group flex items-center gap-3 rounded-md border border-parchment-600/40 bg-parchment-900/25 p-4 transition-all hover:border-gold/60 hover:bg-parchment-900/45"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-parchment-800/70 text-xl shadow-engraved">
                {save.outline?.coverEmoji ?? <Compass size={18} className="text-gold" />}
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate font-serif text-base text-parchment-50">
                  {save.name}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-parchment-200/60">
                  <span>{save.state.mode === 'author' ? '执笔模式' : '游历模式'}</span>
                  <span>·</span>
                  <span>第 {save.state.turn} 回合</span>
                  <span>·</span>
                  <span>{save.state.destiny.currentStage}</span>
                  <span>·</span>
                  <span>{formatSaveTime(save.updatedAt)}</span>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setActive(save.id);
                  setShowSaves(false);
                  nav('/game');
                }}
              >
                <BookOpen size={14} /> 继续
              </Button>
              <Button
                size="sm"
                variant="danger"
                title="删除旅程"
                aria-label={`删除旅程 ${save.name}`}
                onClick={async () => {
                  const confirmed = await confirmDialog({
                    title: '删除旅程',
                    message: `确定删除旅程《${save.name}》吗？此操作不可撤销。`,
                    confirmText: '删除',
                    variant: 'danger',
                  });
                  if (confirmed) remove(save.id);
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}

          {!saveList.length && (
            <div className="py-8 text-center font-serif text-parchment-200/60">
              暂无旅程。
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}

function formatSaveTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}
