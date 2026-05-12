import { Brain, FileText, Zap } from 'lucide-react';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import { ThinkToggle } from '@/components/ThinkToggle';
import type { AgentThought } from '@/types/game';
import { describeCacheHit, formatCacheTokenPair, hasCacheHit } from '@/lib/llmUsage';
import type { SaveStorageStats } from '@/storage/ledgerRepository';

function formatPromptInput(item: AgentThought): string | undefined {
  const prompt = item.prompt;
  if (!prompt) return undefined;
  if (prompt.messages?.length) {
    return prompt.messages
      .map((m, index) => `## ${index + 1}. ${m.role}\n\n${m.content}`)
      .join('\n\n---\n\n');
  }
  const parts = [
    prompt.inputSummary ? `【输入摘要】\n${prompt.inputSummary}` : '',
    prompt.system ? `【System】\n${prompt.system}` : '',
    prompt.user ? `【User】\n${prompt.user}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('\n\n') : undefined;
}

function formatBytes(bytes: number | undefined): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export function AgentThoughtsPanel({
  thoughts,
  storageStats,
}: {
  thoughts?: AgentThought[];
  storageStats?: SaveStorageStats;
}) {
  const items = (thoughts ?? [])
    .filter((item) => item.content?.trim() || item.output?.trim() || item.prompt || item.usage || item.cacheHit)
    .slice(-48)
    .reverse();

  if (!items.length && !storageStats) return null;

  const groups = items.reduce<Array<{ round: number; items: AgentThought[] }>>((acc, item) => {
    const last = acc[acc.length - 1];
    if (last && last.round === item.round) {
      last.items.push(item);
    } else {
      acc.push({ round: item.round, items: [item] });
    }
    return acc;
  }, []);

  return (
    <Card>
      <CardTitle className="flex items-center gap-2 text-base">
        <FileText size={16} /> 模型记录
      </CardTitle>
      <CardMeta>按回合归档各模型调用；可展开输入、思维链与实际输出，闪光标记显示缓存命中 / 未命中 token。</CardMeta>
      {storageStats && (
        <div className="mb-3 rounded border border-gold/25 bg-gold/5 px-3 py-2 text-[11px] text-parchment-200/75">
          <div className="flex items-center justify-between gap-2 font-serif">
            <span className="tracking-[0.2em] text-gold/70 uppercase">当前旅程占用</span>
            <span className="font-mono text-gold-light">{formatBytes(storageStats.totalBytes)}</span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-parchment-200/55">
            <span>回合 {storageStats.roundCount}：{formatBytes(storageStats.roundsBytes)}</span>
            <span>调用 {storageStats.agentCallCount}：{formatBytes(storageStats.agentCallsBytes)}</span>
            <span>快照 {storageStats.snapshotCount}：{formatBytes(storageStats.snapshotsBytes)}</span>
            <span>状态：{formatBytes(storageStats.saveBytes)}</span>
          </div>
          {storageStats.browserQuotaBytes && (
            <div className="mt-1 text-[10px] text-parchment-200/45">
              浏览器当前源已用 {formatBytes(storageStats.browserUsageBytes)} / 可用约 {formatBytes(storageStats.browserQuotaBytes)}
            </div>
          )}
        </div>
      )}
      {!items.length && (
        <div className="text-xs text-parchment-200/55 font-serif">暂无模型调用记录。</div>
      )}
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.round} className="rounded-lg border border-gold/20 bg-parchment-900/20 p-2 overflow-visible">
            <div className="mb-2 flex items-center justify-between text-[10px] tracking-[0.25em] text-gold/60 font-serif uppercase">
              <span>第 {group.round} 回合</span>
              <span>{group.items.length} 次调用</span>
            </div>
            <div className="space-y-2">
              {group.items.map((item) => {
                const cacheHit = hasCacheHit(item.usage, item.cacheHit);
                const cacheTokens = formatCacheTokenPair(item.usage);
                const showCache = cacheHit || !!cacheTokens;
                const promptInput = formatPromptInput(item);
          return (
            <div
              key={item.id}
              className="rounded border border-parchment-600/35 bg-parchment-900/30 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2 text-[11px] text-parchment-200/55">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Brain size={12} className="shrink-0 opacity-70" />
                  <span className="truncate font-serif text-parchment-100/80">{item.label}</span>
                  {showCache && (
                    <span
                      className={[
                        'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 font-mono text-[9px]',
                        cacheHit
                          ? 'border-gold/45 bg-gold/10 text-gold-light'
                          : 'border-parchment-600/45 bg-parchment-900/45 text-parchment-200/55',
                      ].join(' ')}
                      title={describeCacheHit(item.usage)}
                    >
                      <Zap size={9} className={cacheHit ? 'fill-gold/60' : 'opacity-45'} />
                      {cacheTokens || 'hit'}
                    </span>
                  )}
                </span>
                <span className="shrink-0">{new Date(item.createdAt).toLocaleTimeString()}</span>
              </div>
              <div className="mt-2 space-y-1.5">
                <ThinkToggle content={promptInput} label="input" title="显示/隐藏实际输入" compact className="mt-0" />
                <ThinkToggle content={item.content} label="think" title="显示/隐藏思维链" compact className="mt-0" />
                <ThinkToggle content={item.output} label="output" title="显示/隐藏实际输出" compact className="mt-0" autoJson />
              </div>
            </div>
          );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
