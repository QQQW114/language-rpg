import { Brain, FileText } from 'lucide-react';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import { ThinkToggle } from '@/components/ThinkToggle';
import type { AgentThought } from '@/types/game';
import { describeCacheHit, formatCacheTokenPair, hasCacheHit } from '@/lib/llmUsage';

export function AgentThoughtsPanel({ thoughts }: { thoughts?: AgentThought[] }) {
  const items = (thoughts ?? [])
    .filter((item) => item.content?.trim() || item.output?.trim() || item.usage || item.cacheHit)
    .slice(-24)
    .reverse();

  if (!items.length) return null;

  return (
    <Card>
      <CardTitle className="flex items-center gap-2 text-base">
        <FileText size={16} /> 模型记录
      </CardTitle>
      <CardMeta>各模型调用的思维链与实际输出，默认折叠；闪光标记代表缓存命中。</CardMeta>
      <div className="space-y-2">
        {items.map((item) => {
          const cacheHit = hasCacheHit(item.usage, item.cacheHit);
          const cacheTokens = formatCacheTokenPair(item.usage);
          return (
            <div
              key={item.id}
              className="rounded border border-parchment-600/35 bg-parchment-900/30 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2 text-[11px] text-parchment-200/55">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Brain size={12} className="shrink-0 opacity-70" />
                  <span className="truncate font-serif text-parchment-100/80">{item.label}</span>
                  {cacheHit && (
                    <span
                      className="shrink-0 rounded-full border border-gold/45 bg-gold/10 px-1.5 font-mono text-[9px] text-gold-light"
                      title={describeCacheHit(item.usage)}
                    >
                      ⚡{cacheTokens ? ` ${cacheTokens}` : ''}
                    </span>
                  )}
                </span>
                <span className="shrink-0">第 {item.round} 回合</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <ThinkToggle content={item.content} label="think" title="显示/隐藏思维链" compact />
                <ThinkToggle content={item.output} label="output" title="显示/隐藏实际输出" compact />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
