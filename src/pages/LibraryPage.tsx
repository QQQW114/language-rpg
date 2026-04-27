import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, Upload, Trash2, BookOpen, UserRound, Map, Dices } from 'lucide-react';
import { useContentStore, selectAllOutlines, selectAllBackgrounds, selectAllWorldBooks, selectAllEvents } from '@/store/useContentStore';
import { PRESET_OUTLINES } from '@/presets/outlines';
import { PRESET_BACKGROUNDS } from '@/presets/backgrounds';
import { PRESET_WORLDBOOKS } from '@/presets/worldbooks';
import { PRESET_EVENTS } from '@/presets/events';
import { Button } from '@/components/ui/Button';
import { OrnateDivider } from '@/components/ui/Ornaments';
import { ImportDialog } from '@/components/ImportDialog';

type Tab = 'outlines' | 'backgrounds' | 'worldbooks' | 'events';

export default function LibraryPage() {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('outlines');
  const [importOpen, setImportOpen] = useState(false);

  const outlines = useContentStore(selectAllOutlines);
  const backgrounds = useContentStore(selectAllBackgrounds);
  const worldBooks = useContentStore(selectAllWorldBooks);
  const events = useContentStore(selectAllEvents);

  const removeOutline = useContentStore((s) => s.removeOutline);
  const removeBackground = useContentStore((s) => s.removeBackground);
  const removeWorldBook = useContentStore((s) => s.removeWorldBook);
  const removeEvent = useContentStore((s) => s.removeEvent);

  const isPreset = (id: string, kind: Tab): boolean => {
    switch (kind) {
      case 'outlines': return PRESET_OUTLINES.some((x) => x.id === id);
      case 'backgrounds': return PRESET_BACKGROUNDS.some((x) => x.id === id);
      case 'worldbooks': return PRESET_WORLDBOOKS.some((x) => x.id === id);
      case 'events': return PRESET_EVENTS.some((x) => x.id === id);
    }
  };

  const tabs: { id: Tab; label: string; icon: any; count: number }[] = [
    { id: 'outlines', label: '故事大纲', icon: BookOpen, count: outlines.length },
    { id: 'backgrounds', label: '出身', icon: UserRound, count: backgrounds.length },
    { id: 'worldbooks', label: '世界书', icon: Map, count: worldBooks.length },
    { id: 'events', label: '随机事件', icon: Dices, count: events.length },
  ];

  const deletable = (id: string): boolean => !isPreset(id, tab);

  const onDelete = (id: string) => {
    if (!deletable(id)) return;
    if (!confirm('确定删除这个自定义条目？')) return;
    if (tab === 'outlines') removeOutline(id);
    else if (tab === 'backgrounds') removeBackground(id);
    else if (tab === 'worldbooks') removeWorldBook(id);
    else if (tab === 'events') removeEvent(id);
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" onClick={() => nav('/')}>
          <ArrowLeft size={16} /> 返回
        </Button>
        <h1 className="font-serif text-2xl text-gold-light">书库</h1>
        <Button onClick={() => setImportOpen(true)}>
          <Upload size={16} /> 导入
        </Button>
      </div>

      <div className="flex gap-2 mb-4 border-b border-parchment-600/40">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 font-serif text-sm border-b-2 transition-all ${
              tab === t.id
                ? 'text-gold-light border-gold'
                : 'text-parchment-200/70 border-transparent hover:text-parchment-100'
            }`}
          >
            <t.icon size={14} /> {t.label}
            <span className="text-xs text-parchment-200/50">({t.count})</span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {tab === 'outlines' && outlines.map((o) => (
          <Row key={o.id} preset={isPreset(o.id, 'outlines')} onDelete={() => onDelete(o.id)}>
            <div className="flex items-start gap-3">
              <div className="text-2xl">{o.coverEmoji ?? '📖'}</div>
              <div className="flex-1">
                <div className="text-parchment-50 font-serif">{o.title}</div>
                <div className="text-xs text-parchment-200/70 mt-1 leading-relaxed">{o.synopsis}</div>
                {o.tone && <div className="text-xs text-gold/60 mt-1">{o.tone}</div>}
              </div>
            </div>
          </Row>
        ))}

        {tab === 'backgrounds' && backgrounds.map((b) => (
          <Row key={b.id} preset={isPreset(b.id, 'backgrounds')} onDelete={() => onDelete(b.id)}>
            <div className="flex items-start gap-3">
              <div className="text-2xl">{b.coverEmoji ?? '⚔️'}</div>
              <div className="flex-1">
                <div className="text-parchment-50 font-serif">{b.name}</div>
                <div className="text-xs text-parchment-200/70 mt-1 leading-relaxed">{b.description}</div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {b.traits.map((t) => (
                    <span key={t} className="text-[11px] px-2 py-0.5 rounded border border-gold/40 text-parchment-100">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </Row>
        ))}

        {tab === 'worldbooks' && worldBooks.map((w) => (
          <Row key={w.id} preset={isPreset(w.id, 'worldbooks')} onDelete={() => onDelete(w.id)}>
            <div>
              <div className="flex items-center justify-between">
                <div className="text-parchment-50 font-serif">{w.name}</div>
                <div className="text-xs text-parchment-200/60">{w.entries.length} 条</div>
              </div>
              {w.description && (
                <div className="text-xs text-parchment-200/70 mt-1">{w.description}</div>
              )}
              <ul className="text-xs text-parchment-200/80 mt-2 space-y-1 max-h-36 overflow-auto">
                {w.entries.slice(0, 8).map((e) => (
                  <li key={e.id} className="pl-2 border-l border-gold-dark/40">
                    <span className="text-gold/70">{e.name}</span>
                    <span className="text-parchment-200/50 ml-2">
                      [{e.alwaysActive ? '常驻' : e.keywords.join(' / ')}]
                    </span>
                  </li>
                ))}
                {w.entries.length > 8 && (
                  <li className="text-parchment-200/40">… 及其余 {w.entries.length - 8} 条</li>
                )}
              </ul>
            </div>
          </Row>
        ))}

        {tab === 'events' && events.map((e) => (
          <Row key={e.id} preset={isPreset(e.id, 'events')} onDelete={() => onDelete(e.id)}>
            <div>
              <div className="flex items-center justify-between">
                <div className="text-parchment-50 font-serif">{e.name}</div>
                <div className="text-xs text-parchment-200/60">
                  概率 {Math.round(e.probability * 100)}%
                  {e.minRound ? ` · 第 ${e.minRound} 起` : ''}
                  {e.once ? ' · 一次性' : ''}
                </div>
              </div>
              <div className="text-xs text-parchment-200/70 mt-1">{e.directive}</div>
            </div>
          </Row>
        ))}
      </div>

      <OrnateDivider />
      <div className="text-center text-xs text-parchment-200/50 font-serif">
        带锁图标的是预设内容，不可删除。自定义内容通过「导入」按钮添加。
      </div>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function Row({
  children, preset, onDelete,
}: {
  children: React.ReactNode; preset: boolean; onDelete: () => void;
}) {
  return (
    <div className="bg-parchment-800/60 border border-parchment-600/40 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">{children}</div>
        <div className="shrink-0 flex flex-col items-end gap-2">
          {preset ? (
            <span className="text-[10px] text-gold/60 tracking-wider uppercase">· 预设 ·</span>
          ) : (
            <Button size="sm" variant="danger" onClick={onDelete}>
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
