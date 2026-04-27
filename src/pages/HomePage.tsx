import { useNavigate } from 'react-router-dom';
import { useGameStore } from '@/store/useGameStore';
import { Button } from '@/components/ui/Button';
import { CornerFiligree, OrnateDivider } from '@/components/ui/Ornaments';
import { BookOpen, Settings, Library, ScrollText, Trash2, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';

export default function HomePage() {
  const nav = useNavigate();
  const saves = useGameStore((s) => s.saves);
  const setActive = useGameStore((s) => s.setActive);
  const deleteSave = useGameStore((s) => s.deleteSave);
  const [showSaves, setShowSaves] = useState(false);

  const saveList = Object.values(saves).sort((a, b) => b.updatedAt - a.updatedAt);
  const hasSaves = saveList.length > 0;

  return (
    <div className="min-h-full flex items-center justify-center px-6 py-12">
      <div className="relative w-full max-w-3xl text-center">
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
          {hasSaves && (
            <Button size="lg" variant="outline" onClick={() => setShowSaves(true)} className="w-64">
              <PlayCircle size={18} /> 继续旅程（{saveList.length}）
            </Button>
          )}
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" onClick={() => nav('/library')}>
              <Library size={16} /> 书库
            </Button>
            <Button variant="ghost" onClick={() => nav('/settings')}>
              <Settings size={16} /> 设置
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showSaves} onClose={() => setShowSaves(false)} title="选择要继续的旅程">
        <div className="flex flex-col gap-2">
          {saveList.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 p-3 rounded border border-parchment-600/40 hover:border-gold/60 hover:bg-parchment-900/40 transition-all"
            >
              <div className="flex-1 min-w-0">
                <div className="text-parchment-50 font-serif truncate">{s.name}</div>
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
                  if (confirm(`确定删除旅程《${s.name}》吗？此操作不可撤销。`)) {
                    deleteSave(s.id);
                  }
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          {saveList.length === 0 && (
            <div className="text-center text-parchment-200/60 py-6">暂无旅程。</div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
