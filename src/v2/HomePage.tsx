import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  BookPlus,
  Compass,
  Download,
  PlayCircle,
  ScrollText,
  Settings,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { TextStarfield } from '@/components/TextStarfield';
import { Button } from '@/components/ui/Button';
import { confirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog } from '@/components/ui/Dialog';
import { CornerFiligree, OrnateDivider } from '@/components/ui/Ornaments';
import { useGameStoreV2, type SaveV2 } from './store';
import { downloadSaveBackup, parseSaveImport, readSaveFileText } from './saveTransfer';

// Keep this flag in module memory rather than component state. A full browser
// reload evaluates the module again and restores the entrance animation, while
// normal SPA navigation back to the home page keeps it disabled.
let hasPlayedHomeEntrance = false;

export default function HomePageV2() {
  const nav = useNavigate();
  const saves = useGameStoreV2((state) => state.saves);
  const setActive = useGameStoreV2((state) => state.setActive);
  const remove = useGameStoreV2((state) => state.remove);
  const importSave = useGameStoreV2((state) => state.importSave);
  const [showSaves, setShowSaves] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const playEntranceAnimation = !hasPlayedHomeEntrance;

  useEffect(() => {
    hasPlayedHomeEntrance = true;
  }, []);

  const saveList = Object.values(saves).sort((a, b) => b.updatedAt - a.updatedAt);
  const hasSaves = saveList.length > 0;

  const pickImportFile = () => {
    setNotice(null);
    fileInputRef.current?.click();
  };

  /** 导出可恢复存档（不是游戏页的剧情留档）。 */
  const exportSave = (save: SaveV2) => {
    try {
      downloadSaveBackup(save);
      setNotice({
        tone: 'success',
        text: `已导出《${save.name}》的存档备份，可在其他设备用「导入存档」恢复。`,
      });
    } catch (error) {
      setNotice({ tone: 'error', text: `导出失败：${error instanceof Error ? error.message : String(error)}` });
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const text = await readSaveFileText(file);
      const parsed = parseSaveImport(text, { existingSaves: useGameStoreV2.getState().saves });
      if (!parsed.ok || !parsed.save) {
        const reason = parsed.issues.length
          ? parsed.issues.map((item) => item.message).join('；')
          : '无法读取这个存档文件。';
        setNotice({ tone: 'error', text: reason });
        return;
      }
      const imported = parsed.save;
      const id = importSave(imported);
      setShowSaves(false);
      // 导入成功必须给可见反馈；是否立刻进入由玩家决定（存档本身已经落盘）。
      const enterGame = await confirmDialog({
        title: '导入成功',
        message: `旅程《${imported.name}》已保存到当前浏览器（第 ${imported.state.turn} 回合）。`
          + '现在进入这段旅程吗？',
        confirmText: '进入旅程',
        cancelText: '留在主页',
      });
      if (enterGame) {
        setImporting(false);
        setActive(id);
        nav('/game');
        return;
      }
      setNotice({ tone: 'success', text: `已导入《${imported.name}》，可在「继续旅程」中打开。` });
    } catch (error) {
      // 写入 localStorage 失败（配额）时 store 会把原因放进 persistError，优先展示可操作建议。
      const persistError = useGameStoreV2.getState().persistError;
      setNotice({
        tone: 'error',
        text: persistError?.message ?? `导入失败：${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setImporting(false);
      // 清空 value，允许连续选择同一个文件（change 只在 value 变化时触发）。
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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

        {notice && !showSaves && (
          <div className="mx-auto mb-6 max-w-xl">
            <NoticeBar notice={notice} onClose={() => setNotice(null)} />
          </div>
        )}

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
            className={`mt-4 flex flex-wrap justify-center gap-2${playEntranceAnimation ? ' animate-fade-in' : ''}`}
            style={
              playEntranceAnimation
                ? { animationDelay: hasSaves ? '2150ms' : '2040ms' }
                : undefined
            }
          >
            <Button variant="ghost" loading={importing} onClick={pickImportFile}>
              <Upload size={16} /> 导入存档
            </Button>
            <Button variant="ghost" onClick={() => nav('/workshop')}>
              <BookPlus size={16} /> 故事与世界书工坊
            </Button>
            <Button variant="ghost" onClick={() => nav('/settings')}>
              <Settings size={16} /> 模型与连接设置
            </Button>
          </div>
        </div>
      </div>

      {/* 导入存档：hidden file input，主页与存档对话框共用。 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => {
          void importFile(event.target.files?.[0]);
        }}
      />

      <Dialog
        open={showSaves}
        onClose={() => setShowSaves(false)}
        title="选择要继续的旅程"
        widthClass="max-w-3xl"
      >
        <div className="flex flex-col gap-3">
          {notice && <NoticeBar notice={notice} onClose={() => setNotice(null)} />}
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
                variant="outline"
                title="导出存档（JSON 备份，可在其他设备导入）"
                aria-label={`导出存档 ${save.name}`}
                onClick={() => exportSave(save)}
              >
                <Download size={14} />
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

          <div className="mt-1 flex flex-wrap items-center justify-between gap-3 border-t border-parchment-600/30 pt-3">
            <span className="max-w-md text-left text-[11px] leading-relaxed text-parchment-200/50">
              导出的 JSON 是可恢复存档，不是游戏页的剧情留档；导入会作为新旅程加入，不会覆盖现有旅程。
            </span>
            <Button size="sm" variant="outline" loading={importing} onClick={pickImportFile}>
              <Upload size={14} /> 导入存档
            </Button>
          </div>
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

interface Notice {
  tone: 'success' | 'error';
  text: string;
}

/** 与工坊页同款的轻量提示条：只用于导出/导入这类一次性反馈。 */
function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-md border px-4 py-3 text-left text-sm text-parchment-100 ${
        notice.tone === 'error' ? 'border-ember/50 bg-ember/10' : 'border-moss/50 bg-moss/10'
      }`}
    >
      <span className="min-w-0 flex-1 font-serif leading-relaxed">{notice.text}</span>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 text-parchment-200/55 transition-colors hover:text-parchment-50"
        aria-label="关闭提示"
      >
        <X size={15} />
      </button>
    </div>
  );
}
