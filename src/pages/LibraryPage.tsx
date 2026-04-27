import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Dices,
  Map,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import {
  useContentStore,
  selectAllOutlines,
  selectAllBackgrounds,
  selectAllWorldBooks,
  selectAllEvents,
} from '@/store/useContentStore';
import type { Background, RandomEvent, StoryOutline, WorldBook } from '@/types/content';
import { PRESET_OUTLINES } from '@/presets/outlines';
import { PRESET_BACKGROUNDS } from '@/presets/backgrounds';
import { PRESET_WORLDBOOKS } from '@/presets/worldbooks';
import { PRESET_EVENTS } from '@/presets/events';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { OrnateDivider } from '@/components/ui/Ornaments';
import { ImportDialog } from '@/components/ImportDialog';
import { genId } from '@/lib/utils';

type Tab = 'outlines' | 'backgrounds' | 'worldbooks' | 'events';
type EditState =
  | { kind: 'outlines'; item: StoryOutline }
  | { kind: 'backgrounds'; item: Background }
  | { kind: 'worldbooks'; item: WorldBook }
  | { kind: 'events'; item: RandomEvent };

export default function LibraryPage() {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('outlines');
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);

  const outlines = useContentStore(selectAllOutlines);
  const backgrounds = useContentStore(selectAllBackgrounds);
  const worldBooks = useContentStore(selectAllWorldBooks);
  const events = useContentStore(selectAllEvents);

  const customOutlines = useContentStore((s) => s.customOutlines);
  const customBackgrounds = useContentStore((s) => s.customBackgrounds);
  const customWorldBooks = useContentStore((s) => s.customWorldBooks);
  const customEvents = useContentStore((s) => s.customEvents);

  const removeOutline = useContentStore((s) => s.removeOutline);
  const removeBackground = useContentStore((s) => s.removeBackground);
  const removeWorldBook = useContentStore((s) => s.removeWorldBook);
  const removeEvent = useContentStore((s) => s.removeEvent);
  const updateOutline = useContentStore((s) => s.updateOutline);
  const updateBackground = useContentStore((s) => s.updateBackground);
  const updateWorldBook = useContentStore((s) => s.updateWorldBook);
  const updateEvent = useContentStore((s) => s.updateEvent);

  const isPreset = (id: string, kind: Tab): boolean => {
    switch (kind) {
      case 'outlines': return PRESET_OUTLINES.some((x) => x.id === id);
      case 'backgrounds': return PRESET_BACKGROUNDS.some((x) => x.id === id);
      case 'worldbooks': return PRESET_WORLDBOOKS.some((x) => x.id === id);
      case 'events': return PRESET_EVENTS.some((x) => x.id === id);
    }
  };

  const hasCustom = (id: string, kind: Tab): boolean => {
    switch (kind) {
      case 'outlines': return customOutlines.some((x) => x.id === id);
      case 'backgrounds': return customBackgrounds.some((x) => x.id === id);
      case 'worldbooks': return customWorldBooks.some((x) => x.id === id);
      case 'events': return customEvents.some((x) => x.id === id);
    }
  };

  const tabs: { id: Tab; label: string; icon: any; count: number }[] = [
    { id: 'outlines', label: '故事大纲', icon: BookOpen, count: outlines.length },
    { id: 'backgrounds', label: '出身', icon: UserRound, count: backgrounds.length },
    { id: 'worldbooks', label: '世界书', icon: Map, count: worldBooks.length },
    { id: 'events', label: '随机事件', icon: Dices, count: events.length },
  ];

  const deletable = (id: string): boolean => !isPreset(id, tab) || hasCustom(id, tab);

  const onDelete = (id: string) => {
    if (!deletable(id)) return;
    const modifiedPreset = isPreset(id, tab) && hasCustom(id, tab);
    const msg = modifiedPreset
      ? '确定删除这个本地修改？删除后会恢复为预设原版。'
      : '确定删除这个自定义条目？';
    if (tab !== 'events' && !confirm(msg)) return;
    if (tab === 'outlines') removeOutline(id);
    else if (tab === 'backgrounds') removeBackground(id);
    else if (tab === 'worldbooks') removeWorldBook(id);
    else if (tab === 'events') removeEvent(id);
    if (editing?.kind === tab && editing.item.id === id) setEditing(null);
  };

  const startEdit = (state: EditState) => setEditing(cloneEditState(state));

  const saveEdit = () => {
    if (!editing) return;
    if (editing.kind === 'outlines') updateOutline(normalizeOutline(editing.item));
    else if (editing.kind === 'backgrounds') updateBackground(normalizeBackground(editing.item));
    else if (editing.kind === 'worldbooks') updateWorldBook(normalizeWorldBook(editing.item));
    else updateEvent(normalizeEvent(editing.item));
    setEditing(null);
  };

  const updateEditing = (fn: (state: EditState) => EditState) => {
    setEditing((cur) => (cur ? fn(cur) : cur));
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
            onClick={() => {
              setTab(t.id);
              setEditing(null);
            }}
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
        {tab === 'outlines' && outlines.map((o) => {
          const isEditing = editing?.kind === 'outlines' && editing.item.id === o.id;
          return (
            <Row
              key={o.id}
              preset={isPreset(o.id, 'outlines')}
              modified={hasCustom(o.id, 'outlines')}
              editing={isEditing}
              onEdit={() => startEdit({ kind: 'outlines', item: o })}
              onDelete={() => onDelete(o.id)}
            >
              {isEditing && editing.kind === 'outlines' ? (
                <OutlineEditForm
                  value={editing.item}
                  onChange={(item) => updateEditing((s) => s.kind === 'outlines' ? { ...s, item } : s)}
                  onCancel={() => setEditing(null)}
                  onSave={saveEdit}
                />
              ) : (
                <div className="flex items-start gap-3">
                  <div className="text-2xl">{o.coverEmoji ?? '📖'}</div>
                  <div className="flex-1">
                    <div className="text-parchment-50 font-serif">{o.title}</div>
                    <div className="text-xs text-parchment-200/70 mt-1 leading-relaxed">{o.synopsis}</div>
                    {o.tone && <div className="text-xs text-gold/60 mt-1">{o.tone}</div>}
                  </div>
                </div>
              )}
            </Row>
          );
        })}

        {tab === 'backgrounds' && backgrounds.map((b) => {
          const isEditing = editing?.kind === 'backgrounds' && editing.item.id === b.id;
          return (
            <Row
              key={b.id}
              preset={isPreset(b.id, 'backgrounds')}
              modified={hasCustom(b.id, 'backgrounds')}
              editing={isEditing}
              onEdit={() => startEdit({ kind: 'backgrounds', item: b })}
              onDelete={() => onDelete(b.id)}
            >
              {isEditing && editing.kind === 'backgrounds' ? (
                <BackgroundEditForm
                  value={editing.item}
                  onChange={(item) => updateEditing((s) => s.kind === 'backgrounds' ? { ...s, item } : s)}
                  onCancel={() => setEditing(null)}
                  onSave={saveEdit}
                />
              ) : (
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
              )}
            </Row>
          );
        })}

        {tab === 'worldbooks' && worldBooks.map((w) => {
          const isEditing = editing?.kind === 'worldbooks' && editing.item.id === w.id;
          return (
            <Row
              key={w.id}
              preset={isPreset(w.id, 'worldbooks')}
              modified={hasCustom(w.id, 'worldbooks')}
              editing={isEditing}
              onEdit={() => startEdit({ kind: 'worldbooks', item: w })}
              onDelete={() => onDelete(w.id)}
            >
              {isEditing && editing.kind === 'worldbooks' ? (
                <WorldBookEditForm
                  value={editing.item}
                  onChange={(item) => updateEditing((s) => s.kind === 'worldbooks' ? { ...s, item } : s)}
                  onCancel={() => setEditing(null)}
                  onSave={saveEdit}
                />
              ) : (
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
              )}
            </Row>
          );
        })}

        {tab === 'events' && events.map((e) => {
          const isEditing = editing?.kind === 'events' && editing.item.id === e.id;
          return (
            <Row
              key={e.id}
              preset={isPreset(e.id, 'events')}
              modified={hasCustom(e.id, 'events')}
              editing={isEditing}
              onEdit={() => startEdit({ kind: 'events', item: e })}
              onDelete={() => onDelete(e.id)}
            >
              {isEditing && editing.kind === 'events' ? (
                <EventEditForm
                  value={editing.item}
                  onChange={(item) => updateEditing((s) => s.kind === 'events' ? { ...s, item } : s)}
                  onCancel={() => setEditing(null)}
                  onSave={saveEdit}
                />
              ) : (
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-parchment-50 font-serif">{e.name}</div>
                    <div className="text-xs text-parchment-200/60">
                      概率 {Math.round(e.probability * 100)}%
                      {e.minRound ? ` · 第 ${e.minRound} 起` : ''}
                      {e.cooldown ? ` · 冷却 ${e.cooldown}` : ''}
                      {e.once ? ' · 一次性' : ''}
                    </div>
                  </div>
                  <div className="text-xs text-parchment-200/70 mt-1">{e.directive}</div>
                </div>
              )}
            </Row>
          );
        })}
      </div>

      <OrnateDivider />
      <div className="text-center text-xs text-parchment-200/50 font-serif leading-relaxed">
        预设内容也可以编辑；保存后会写入本地覆盖，不会改动内置原件。删除已修改的预设会恢复原版。
      </div>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function Row({
  children,
  preset,
  modified,
  editing,
  onDelete,
  onEdit,
}: {
  children: React.ReactNode;
  preset: boolean;
  modified?: boolean;
  editing?: boolean;
  onDelete: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="bg-parchment-800/60 border border-parchment-600/40 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">{children}</div>
        <div className="shrink-0 flex flex-col items-end gap-2">
          {preset ? (
            <span className="text-[10px] text-gold/60 tracking-wider uppercase">
              {modified ? '· 已修改 ·' : '· 预设 ·'}
            </span>
          ) : (
            <span className="text-[10px] text-parchment-200/50 tracking-wider uppercase">· 自定义 ·</span>
          )}
          {!editing && (
            <>
              <Button size="sm" variant="outline" onClick={onEdit} title="编辑">
                <Pencil size={12} />
              </Button>
              {(!preset || modified) && (
                <Button size="sm" variant="danger" onClick={onDelete} title={preset ? '恢复预设' : '删除'}>
                  <Trash2 size={12} />
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OutlineEditForm({
  value,
  onChange,
  onCancel,
  onSave,
}: {
  value: StoryOutline;
  onChange: (value: StoryOutline) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-[80px_1fr]">
        <Input
          label="符号"
          value={value.coverEmoji ?? ''}
          onChange={(e) => onChange({ ...value, coverEmoji: e.target.value })}
          placeholder="📖"
        />
        <Input
          label="标题"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </div>
      <Textarea
        label="梗概"
        value={value.synopsis}
        onChange={(e) => onChange({ ...value, synopsis: e.target.value })}
        rows={4}
      />
      <Textarea
        label="章节/阶段（每行一个）"
        value={value.acts.join('\n')}
        onChange={(e) => onChange({ ...value, acts: splitLines(e.target.value) })}
        rows={4}
      />
      <Input
        label="文风/题材"
        value={value.tone ?? ''}
        onChange={(e) => onChange({ ...value, tone: e.target.value })}
      />
      <Textarea
        label="默认挂载世界书 ID（每行一个，可留空）"
        value={(value.worldBookIds ?? []).join('\n')}
        onChange={(e) => onChange({ ...value, worldBookIds: splitLines(e.target.value) })}
        rows={3}
      />
      <EditActions onCancel={onCancel} onSave={onSave} />
    </div>
  );
}

function BackgroundEditForm({
  value,
  onChange,
  onCancel,
  onSave,
}: {
  value: Background;
  onChange: (value: Background) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-[80px_1fr]">
        <Input
          label="符号"
          value={value.coverEmoji ?? ''}
          onChange={(e) => onChange({ ...value, coverEmoji: e.target.value })}
          placeholder="⚔️"
        />
        <Input
          label="出身名"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </div>
      <Textarea
        label="描述"
        value={value.description}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
        rows={4}
      />
      <Textarea
        label="特质（每行一个）"
        value={value.traits.join('\n')}
        onChange={(e) => onChange({ ...value, traits: splitLines(e.target.value) })}
        rows={3}
      />
      <Textarea
        label="初始物品（每行一个）"
        value={value.startItems.join('\n')}
        onChange={(e) => onChange({ ...value, startItems: splitLines(e.target.value) })}
        rows={3}
      />
      <Textarea
        label="开局场景"
        value={value.startScene}
        onChange={(e) => onChange({ ...value, startScene: e.target.value })}
        rows={5}
      />
      <EditActions onCancel={onCancel} onSave={onSave} />
    </div>
  );
}

function WorldBookEditForm({
  value,
  onChange,
  onCancel,
  onSave,
}: {
  value: WorldBook;
  onChange: (value: WorldBook) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const updateEntry = (index: number, patch: Partial<WorldBook['entries'][number]>) => {
    onChange({
      ...value,
      entries: value.entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    });
  };

  return (
    <div>
      <Input
        label="世界书名"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <Textarea
        label="简介"
        value={value.description ?? ''}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
        rows={3}
      />
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-gold-light tracking-wide">条目</div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange({
            ...value,
            entries: [
              ...value.entries,
              {
                id: genId('wbe'),
                name: '新条目',
                keywords: [],
                content: '',
                priority: 0,
                alwaysActive: false,
              },
            ],
          })}
        >
          <Plus size={12} /> 添加条目
        </Button>
      </div>
      <div className="space-y-3">
        {value.entries.map((entry, index) => (
          <div key={entry.id} className="rounded-md border border-parchment-600/40 bg-parchment-900/30 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="grid gap-3 md:grid-cols-[1fr_120px] flex-1">
                <Input
                  label="条目名"
                  value={entry.name}
                  onChange={(e) => updateEntry(index, { name: e.target.value })}
                />
                <Input
                  label="优先级"
                  type="number"
                  value={entry.priority ?? 0}
                  onChange={(e) => updateEntry(index, { priority: Number(e.target.value) || 0 })}
                />
              </div>
              <Button
                size="sm"
                variant="danger"
                onClick={() => onChange({ ...value, entries: value.entries.filter((_, i) => i !== index) })}
                title="删除条目"
              >
                <Trash2 size={12} />
              </Button>
            </div>
            <label className="mb-3 flex items-center gap-2 text-xs text-parchment-200/80 cursor-pointer">
              <input
                type="checkbox"
                checked={!!entry.alwaysActive}
                onChange={(e) => updateEntry(index, { alwaysActive: e.target.checked })}
                className="accent-gold"
              />
              常驻条目（无需关键词也会注入）
            </label>
            <Input
              label="关键词（用逗号、顿号或换行分隔）"
              value={entry.keywords.join('，')}
              onChange={(e) => updateEntry(index, { keywords: splitList(e.target.value) })}
            />
            <Textarea
              label="内容"
              value={entry.content}
              onChange={(e) => updateEntry(index, { content: e.target.value })}
              rows={4}
            />
          </div>
        ))}
        {value.entries.length === 0 && (
          <div className="text-xs text-parchment-200/60 border border-dashed border-parchment-600/40 rounded p-3">
            暂无条目。请点击「添加条目」。
          </div>
        )}
      </div>
      <EditActions onCancel={onCancel} onSave={onSave} />
    </div>
  );
}

function EventEditForm({
  value,
  onChange,
  onCancel,
  onSave,
}: {
  value: RandomEvent;
  onChange: (value: RandomEvent) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div>
      <Input
        label="事件名"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <Textarea
        label="事件指令"
        value={value.directive}
        onChange={(e) => onChange({ ...value, directive: e.target.value })}
        rows={4}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <Input
          label="触发概率（%）"
          type="number"
          min={0}
          max={100}
          value={Math.round((value.probability ?? 0) * 100)}
          onChange={(e) => onChange({ ...value, probability: clamp01((Number(e.target.value) || 0) / 100) })}
        />
        <Input
          label="最早触发回合"
          type="number"
          min={1}
          value={value.minRound ?? ''}
          onChange={(e) => onChange({ ...value, minRound: optionalPositiveInt(e.target.value) })}
        />
        <Input
          label="冷却回合"
          type="number"
          min={0}
          value={value.cooldown ?? ''}
          onChange={(e) => onChange({ ...value, cooldown: optionalPositiveInt(e.target.value, true) })}
        />
      </div>
      <label className="mb-3 flex items-center gap-2 text-sm text-parchment-200/80 cursor-pointer">
        <input
          type="checkbox"
          checked={!!value.once}
          onChange={(e) => onChange({ ...value, once: e.target.checked })}
          className="accent-gold"
        />
        只触发一次
      </label>
      <EditActions onCancel={onCancel} onSave={onSave} />
    </div>
  );
}

function EditActions({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  return (
    <div className="flex justify-end gap-2 mt-4">
      <Button variant="ghost" size="sm" onClick={onCancel}>
        <X size={14} /> 取消
      </Button>
      <Button size="sm" onClick={onSave}>
        <Save size={14} /> 保存
      </Button>
    </div>
  );
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function splitList(text: string): string[] {
  return text
    .split(/[\r\n,，、]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function cloneEditState(state: EditState): EditState {
  if (state.kind === 'outlines') {
    return {
      kind: state.kind,
      item: {
        ...state.item,
        acts: [...state.item.acts],
        worldBookIds: [...(state.item.worldBookIds ?? [])],
      },
    };
  }
  if (state.kind === 'backgrounds') {
    return {
      kind: state.kind,
      item: {
        ...state.item,
        traits: [...state.item.traits],
        startItems: [...state.item.startItems],
      },
    };
  }
  if (state.kind === 'worldbooks') {
    return {
      kind: state.kind,
      item: {
        ...state.item,
        entries: state.item.entries.map((entry) => ({
          ...entry,
          keywords: [...entry.keywords],
        })),
      },
    };
  }
  return { kind: state.kind, item: { ...state.item } };
}

function normalizeOutline(item: StoryOutline): StoryOutline {
  return {
    ...item,
    title: item.title.trim() || '未命名故事',
    synopsis: item.synopsis.trim(),
    acts: item.acts.map((x) => x.trim()).filter(Boolean),
    tone: item.tone?.trim() || undefined,
    worldBookIds: item.worldBookIds?.map((x) => x.trim()).filter(Boolean),
    coverEmoji: item.coverEmoji?.trim() || undefined,
  };
}

function normalizeBackground(item: Background): Background {
  return {
    ...item,
    name: item.name.trim() || '未命名出身',
    description: item.description.trim(),
    traits: item.traits.map((x) => x.trim()).filter(Boolean),
    startItems: item.startItems.map((x) => x.trim()).filter(Boolean),
    startScene: item.startScene.trim(),
    coverEmoji: item.coverEmoji?.trim() || undefined,
  };
}

function normalizeWorldBook(item: WorldBook): WorldBook {
  return {
    ...item,
    name: item.name.trim() || '未命名世界书',
    description: item.description?.trim() || undefined,
    entries: item.entries.map((entry) => ({
      ...entry,
      name: entry.name.trim() || '未命名条目',
      keywords: entry.keywords.map((x) => x.trim()).filter(Boolean),
      content: entry.content.trim(),
      priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 0,
      alwaysActive: !!entry.alwaysActive,
    })),
  };
}

function normalizeEvent(item: RandomEvent): RandomEvent {
  return {
    ...item,
    name: item.name.trim() || '未命名事件',
    directive: item.directive.trim(),
    probability: clamp01(Number(item.probability) || 0),
    minRound: positiveOrUndefined(item.minRound),
    cooldown: positiveOrUndefined(item.cooldown, true),
    once: !!item.once,
  };
}

function optionalPositiveInt(text: string, allowZero = false): number | undefined {
  if (text.trim() === '') return undefined;
  return positiveOrUndefined(Number(text), allowZero);
}

function positiveOrUndefined(value: unknown, allowZero = false): number | undefined {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num)) return undefined;
  const min = allowZero ? 0 : 1;
  return Math.max(min, num);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
