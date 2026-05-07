import { useNavigate } from 'react-router-dom';
import { useGameStore } from '@/store/useGameStore';
import { useContentStore } from '@/store/useContentStore';
import { Button } from '@/components/ui/Button';
import { CornerFiligree, OrnateDivider } from '@/components/ui/Ornaments';
import { TextStarfield } from '@/components/TextStarfield';
import { BookMarked, BookOpen, Settings, Library, ScrollText, Trash2, PlayCircle, Upload, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { instantiateJourneyPackage, parseJourneyPackage } from '@/lib/journeyPackage';
import { parseLedgerJourneyZip } from '@/lib/ledgerJourneyPackage';
import { importLedgerPackage } from '@/storage/ledgerRepository';
import { confirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/lib/toast';

export default function HomePage() {
  const nav = useNavigate();
  const saves = useGameStore((s) => s.saves);
  const setActive = useGameStore((s) => s.setActive);
  const deleteSave = useGameStore((s) => s.deleteSave);
  const importSave = useGameStore((s) => s.importSave);
  const [showSaves, setShowSaves] = useState(false);
  const [importError, setImportError] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const saveList = Object.values(saves).sort((a, b) => b.updatedAt - a.updatedAt);
  const hasSaves = saveList.length > 0;

  async function onImportJourneyFile(file: File | undefined) {
    if (!file) return;
    setImportError(undefined);
    try {
      const content = useContentStore.getState();
      if (file.name.toLowerCase().endsWith('.zip')) {
        const pkg = parseLedgerJourneyZip(await file.arrayBuffer());
        pkg.resources?.outlines?.forEach(content.addOutline);
        pkg.resources?.backgrounds?.forEach(content.addBackground);
        pkg.resources?.worldBooks?.forEach(content.addWorldBook);
        pkg.resources?.events?.forEach(content.addEvent);
        const save = await importLedgerPackage(pkg);
        useGameStore.setState((s) => ({
          saves: { ...s.saves, [save.id]: save },
          activeSaveId: save.id,
        }));
        setActive(save.id);
      } else {
        const text = await file.text();
        const pkg = parseJourneyPackage(text);
        const instantiated = instantiateJourneyPackage(pkg);
        instantiated.resources.outlines.forEach(content.addOutline);
        instantiated.resources.backgrounds.forEach(content.addBackground);
        instantiated.resources.worldBooks.forEach(content.addWorldBook);
        instantiated.resources.events.forEach(content.addEvent);
        const id = importSave(instantiated.save);
        setActive(id);
      }
      nav('/game');
    } catch (err: any) {
      const m = err?.message ?? String(err); setImportError(m); toast.danger(`导入失败：${m}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="relative min-h-full flex items-center justify-center px-6 py-12 overflow-hidden">
      <TextStarfield autoImpulse={8} />
      <div className="relative z-10 w-full max-w-3xl text-center">
        <CornerFiligree className="absolute -top-6 -left-6 w-20 h-20" />
        <CornerFiligree className="absolute -top-6 -right-6 w-20 h-20 rotate-90" />
        <CornerFiligree className="absolute -bottom-6 -left-6 w-20 h-20 -rotate-90" />
        <CornerFiligree className="absolute -bottom-6 -right-6 w-20 h-20 rotate-180" />

        <div className="mb-2 tracking-[0.8em] text-sm text-gold/70">LANGUAGE · RPG</div>
        <h1 className="title-engraved font-serif text-6xl md:text-7xl leading-none mb-3 tracking-widest">
          言 · 灵
        </h1>
        <div className="text-parchment-200/70 mb-8 font-serif text-base">
          由语言编织的世界，因你的抉择而流转
        </div>

        <OrnateDivider />

        <div className="text-parchment-200/80 font-serif text-sm leading-loose max-w-xl mx-auto mb-10">
          选定一段故事、一种出身，由故事之笔与决策之镜相伴，
          <br />
          在有限的回合内抵达属于你的结局。
        </div>

        <div className="flex flex-col gap-3 items-center">
          <Button size="lg" onClick={() => nav('/setup')} className="w-64">
            <ScrollText size={18} /> 启程 · 开始新旅程
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => nav('/presets')}
            className="w-64"
          >
            <Sparkles size={18} /> 执笔模式 · 一键启程
          </Button>
          {hasSaves && (
            <Button size="lg" variant="outline" onClick={() => setShowSaves(true)} className="w-64">
              <PlayCircle size={18} /> 继续旅程（{saveList.length}）
            </Button>
          )}
          <Button size="lg" variant="outline" onClick={() => fileInputRef.current?.click()} className="w-64">
            <Upload size={18} /> 导入旅程包
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            className="hidden"
            onChange={(e) => onImportJourneyFile(e.target.files?.[0])}
          />
          {importError && (
            <div className="w-64 text-left text-xs text-blood bg-blood/10 border border-blood/50 rounded px-3 py-2 font-serif">
              导入失败：{importError}
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" onClick={() => nav('/library')}>
              <Library size={16} /> 书库
            </Button>
            {hasSaves && (
              <Button variant="ghost" onClick={() => nav('/workspace')}>
                <BookMarked size={16} /> 司书库
              </Button>
            )}
            <Button variant="ghost" onClick={() => nav('/settings')}>
              <Settings size={16} /> 设置
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showSaves} onClose={() => setShowSaves(false)} title="选择要继续的旅程">
        <div className="flex flex-col gap-2">
          {saveList.map((s) => {
            const legacy = s.content.mode === 'author' && !s.state.authorNarrative?.masterArc;
            return (
            <div
              key={s.id}
              className="flex items-center gap-3 p-3 rounded border border-parchment-600/40 hover:border-gold/60 hover:bg-parchment-900/40 transition-all"
            >
              <div className="flex-1 min-w-0">
                <div className="text-parchment-50 font-serif truncate">
                  {s.name}
                  {legacy && <span className="ml-2 text-[10px] text-blood/80">旧版 · 不可继续</span>}
                </div>
                <div className="text-xs text-parchment-200/60">
                  第 {s.state.currentRound} / {s.config.totalRounds} 回合 ·
                  {' '}
                  {new Date(s.updatedAt).toLocaleString()} ·
                  {' '}
                  {s.state.phase === 'ended' ? '已完结' : '进行中'}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  if (legacy) {
                    toast.warn('此存档创建于阶段化叙事之前，不再支持继续游玩。请创建新旅程。');
                    return;
                  }
                  setActive(s.id);
                  setShowSaves(false);
                  nav('/game');
                }}
              >
                <BookOpen size={14} /> 继续
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  confirmDialog({
                    title: '删除旅程',
                    message: `确定删除旅程《${s.name}》吗？此操作不可撤销。`,
                    confirmText: '删除',
                    variant: 'danger',
                  }).then((ok) => { if (ok) deleteSave(s.id); });
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          );
          })}
          {saveList.length === 0 && (
            <div className="text-center text-parchment-200/60 py-6">暂无旅程。</div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
