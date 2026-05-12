import type { Background, StoryOutline } from '@/types/content';
import { BookOpen, User, FileText, Sparkles, Package } from 'lucide-react';

interface CharacterPanelProps {
  characterName?: string;
  outline?: StoryOutline;
  background?: Background;
  summary?: string;
  longTermMemory?: string;
  activeWorldBookCount: number;
  triggeredEventsCount: number;
  refreshesLeft?: number;
  itemCount?: number;
}

export function CharacterPanel({
  characterName, outline, background, summary, longTermMemory, activeWorldBookCount, triggeredEventsCount, refreshesLeft, itemCount,
}: CharacterPanelProps) {
  return (
    <aside className="flex flex-col gap-4 font-serif text-sm">
      <section>
        <h3 className="flex items-center gap-2 text-gold-light tracking-wider mb-2 text-xs uppercase">
          <User size={14} /> 角色
        </h3>
        <div className="bg-parchment-800/60 border border-parchment-600/40 rounded-md p-3">
          <div className="text-lg text-parchment-50">{characterName || '未命名旅人'}</div>
          {background && (
            <>
              <div className="text-xs text-gold/70 mt-1">
                {background.coverEmoji} {background.name}
              </div>
              <div className="text-xs text-parchment-200/80 mt-2 leading-relaxed">
                {background.description}
              </div>
              {background.traits.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] text-parchment-200/50 uppercase tracking-wider mb-1">特质</div>
                  <div className="flex flex-wrap gap-1">
                    {background.traits.map((t) => (
                      <span
                        key={t}
                        className="text-xs px-2 py-0.5 rounded border border-gold/40 text-parchment-100 bg-parchment-900/40"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {background.startItems.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] text-parchment-200/50 uppercase tracking-wider mb-1">初始能力</div>
                  <ul className="text-xs text-parchment-200/90 list-disc pl-4 space-y-0.5">
                    {background.startItems.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {outline && (
        <section>
          <h3 className="flex items-center gap-2 text-gold-light tracking-wider mb-2 text-xs uppercase">
            <BookOpen size={14} /> 故事
          </h3>
          <div className="bg-parchment-800/60 border border-parchment-600/40 rounded-md p-3">
            <div className="text-parchment-50">{outline.coverEmoji} {outline.title}</div>
            <div className="text-xs text-parchment-200/70 mt-2 leading-relaxed">
              {outline.synopsis}
            </div>
          </div>
        </section>
      )}

      {summary && (
        <section>
          <h3 className="flex items-center gap-2 text-gold-light tracking-wider mb-2 text-xs uppercase">
            <FileText size={14} /> 过往
          </h3>
          <div className="bg-parchment-800/60 border border-parchment-600/40 rounded-md p-3 text-xs text-parchment-200/90 leading-relaxed max-h-48 overflow-auto">
            {summary}
          </div>
        </section>
      )}

      {longTermMemory && (
        <section>
          <h3 className="flex items-center gap-2 text-gold-light tracking-wider mb-2 text-xs uppercase">
            <FileText size={14} /> 长期记忆
          </h3>
          <div className="bg-parchment-800/60 border border-parchment-600/40 rounded-md p-3 text-xs text-parchment-200/90 leading-relaxed max-h-48 overflow-auto whitespace-pre-wrap">
            {longTermMemory}
          </div>
        </section>
      )}

      <section>
        <h3 className="flex items-center gap-2 text-gold-light tracking-wider mb-2 text-xs uppercase">
          <Sparkles size={14} /> 状态
        </h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-parchment-800/60 border border-parchment-600/40 rounded p-2">
            <div className="text-parchment-200/60">激活世界书</div>
            <div className="text-gold-light text-lg">{activeWorldBookCount}</div>
          </div>
          <div className="bg-parchment-800/60 border border-parchment-600/40 rounded p-2">
            <div className="text-parchment-200/60">已触发事件</div>
            <div className="text-gold-light text-lg">{triggeredEventsCount}</div>
          </div>
          {itemCount !== undefined && (
            <div className="bg-parchment-800/60 border border-parchment-600/40 rounded p-2">
              <div className="text-parchment-200/60 flex items-center gap-1">
                <Package size={10} /> 能力
              </div>
              <div className="text-gold-light text-lg">{itemCount}</div>
            </div>
          )}
          {refreshesLeft !== undefined && (
            <div className="bg-parchment-800/60 border border-parchment-600/40 rounded p-2">
              <div className="text-parchment-200/60">刷新决策</div>
              <div className="text-gold-light text-lg">{refreshesLeft}</div>
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}
