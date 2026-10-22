import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { cacheHitRate, formatCacheHitRate } from '@/lib/llmUsage';
import type { LlmUsage } from '@/types/llm';
import type { ModelActivityV2, ModelPhaseV2, PatchCategoryStatsV2, PatchStatsV2 } from './types';

export const PHASE_LABEL: Record<ModelPhaseV2, string> = {
  planner_pre: '规划故事路径',
  story: '书写故事正文',
  planner_post: '整理状态与命运进展',
};

const PHASE_META: Record<ModelPhaseV2, { code: string; roleTitle: string; subtitle: string }> = {
  planner_pre: {
    code: 'STAGE 01 · PRE',
    roleTitle: '规划之镜',
    subtitle: '审视玩家意图、世界硬规则与命运汇合路径',
  },
  story: {
    code: 'STAGE 02 · STORY',
    roleTitle: '故事之笔',
    subtitle: '按叙事速度与写前简报织就当回正文',
  },
  planner_post: {
    code: 'STAGE 03 · POST',
    roleTitle: '司书之秤',
    subtitle: '独立审阅真实正文，提取增量状态与命运演进',
  },
};

function tokenCount(value: number | undefined): string {
  return Math.max(0, Math.round(value ?? 0)).toLocaleString('zh-CN');
}

function cacheHitTokens(usage: LlmUsage | undefined): number {
  return usage?.cache?.hitTokens ?? usage?.cache?.cachedTokens ?? 0;
}

export function sumUsage(usages: Array<LlmUsage | undefined>): LlmUsage | undefined {
  const present = usages.filter((usage): usage is LlmUsage => !!usage);
  if (!present.length) return undefined;
  const promptTokens = present.reduce((sum, usage) => sum + (usage.promptTokens ?? 0), 0);
  const completionTokens = present.reduce((sum, usage) => sum + (usage.completionTokens ?? 0), 0);
  const hitTokens = present.reduce((sum, usage) => sum + cacheHitTokens(usage), 0);
  const missTokens = present.reduce(
    (sum, usage) => sum + (usage.cache?.missTokens ?? Math.max(0, (usage.promptTokens ?? 0) - cacheHitTokens(usage))),
    0,
  );
  const totalTokens = promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens, cache: { hitTokens, missTokens } };
}

function copyTextSafe(text: string): boolean {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 降级到 execCommand
  }
  try {
    if (typeof document === 'undefined') return false;
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
    return true;
  } catch {
    return false;
  }
}

/**
 * 司辰星盘微缩图标：结合暗金古书与精密仪器的双环 SVG 动效。
 * 运行中（busy）外圈刻度环顺时针慢转，内圈星芒逆时针微转；静止时保持古铜蚀刻质感。
 */
function AstrolabeDial({ busy }: { busy: boolean }) {
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/35 bg-ink/80 shadow-inset-deep">
      <svg
        viewBox="0 0 36 36"
        className="h-7 w-7 overflow-visible text-gold"
        aria-hidden="true"
      >
        {/* 外层星盘虚线刻度环 */}
        <circle
          cx="18"
          cy="18"
          r="14.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 2.5"
          className=" opacity-55"
          style={busy ? { transformOrigin: '18px 18px', animation: 'spin 9s linear infinite' } : undefined}
        />
        {/* 中层观测环 */}
        <circle
          cx="18"
          cy="18"
          r="10.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeDasharray="8 4"
          className="text-gold-light opacity-75"
          style={busy ? { transformOrigin: '18px 18px', animation: 'spin 5s linear infinite reverse' } : undefined}
        />
        {/* 十字准星刻度 */}
        <path
          d="M18 1.5 V5 M18 31 V34.5 M1.5 18 H5 M31 18 H34.5"
          stroke="currentColor"
          strokeWidth="1"
          className="opacity-45"
        />
        {/* 核心四角星针 */}
        <path
          d="M18 11 L19.8 16.2 L25 18 L19.8 19.8 L18 25 L16.2 19.8 L11 18 L16.2 16.2 Z"
          fill="currentColor"
          className={busy ? 'text-gold-light animate-pulse' : 'text-gold/85'}
        />
      </svg>
      {busy && (
        <span className="pointer-events-none absolute inset-0 rounded-full border border-gold-light/40 animate-ping opacity-30" />
      )}
    </div>
  );
}

/**
 * KV 缓存与 Token 能量刻度尺：将原本单调的数字行升级为「微缩进度尺 + 等宽遥测读数」。
 */
export function UsageLine({ usage, total = false }: { usage: LlmUsage; total?: boolean }) {
  const totalTokens = usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  const hit = cacheHitTokens(usage);
  const miss = usage.cache?.missTokens ?? Math.max(0, (usage.promptTokens ?? 0) - hit);
  const rateText = formatCacheHitRate(usage);
  const rateNum = cacheHitRate(usage);
  const hitPercent = rateNum !== undefined ? Math.round(rateNum * 100) : 0;

  return (
    <div className={`rounded-lg border px-3 py-2 ${total ? 'border-gold/25 bg-ink/55 shadow-inset-deep' : 'border-parchment-600/20 bg-ink/35'}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[10px]">
        <div className="flex items-center gap-2">
          <span className={`font-serif tracking-[0.14em] ${total ? 'text-gold-light font-semibold' : 'text-gold/75'}`}>
            {total ? '✦ 本轮总计遥测' : '· 阶段遥测'}
          </span>
          {rateText && (
            <span className="rounded border border-moss/45 bg-moss/15 px-1.5 py-0.2 text-[9px] text-moss-light">
              KV 命中 {rateText}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums text-parchment-200/65">
          <span>
            输入 <strong className="font-normal text-parchment-100">{tokenCount(usage.promptTokens)}</strong>
          </span>
          <span>
            命中 <strong className="font-normal text-gold-light">{tokenCount(hit)}</strong>
          </span>
          <span>
            未命中 <strong className="font-normal text-parchment-200/50">{tokenCount(miss)}</strong>
          </span>
          <span>
            输出 <strong className="font-normal text-parchment-100">{tokenCount(usage.completionTokens)}</strong>
          </span>
          <span className="text-gold-light">
            合计 <strong>{tokenCount(totalTokens)}</strong>
          </span>
        </div>
      </div>

      {/* 缓存命中可视化微缩刻度条 */}
      {(usage.promptTokens ?? 0) > 0 && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-parchment-900/90">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold-dark via-gold to-gold-light transition-all duration-500"
              style={{ width: `${Math.max(0, Math.min(100, hitPercent))}%` }}
            />
          </div>
          <span className="font-mono text-[9px] tabular-nums text-parchment-200/40">
            CACHE {rateText ?? '—'}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * 写后结算对账印鉴矩阵：五维分类展示（人物/关系/背包/线索/事实）的提交、采纳与拦截情况。
 */
function PatchReconciliationMatrix({ patchStats }: { patchStats: PatchStatsV2 }) {
  const categories: Array<{ key: string; label: string; code: string; stats: PatchCategoryStatsV2 }> = [
    { key: 'characters', label: '人物', code: 'CHR', stats: patchStats.characters },
    { key: 'relationships', label: '关系', code: 'REL', stats: patchStats.relationships },
    { key: 'inventory', label: '物品', code: 'INV', stats: patchStats.inventory },
    { key: 'threads', label: '线索', code: 'THD', stats: patchStats.threads },
    { key: 'facts', label: '事实', code: 'FCT', stats: patchStats.facts },
  ];

  const applied = categories.reduce((sum, c) => sum + c.stats.applied, 0);
  const input = categories.reduce((sum, c) => sum + c.stats.input, 0);
  const blocked = categories.reduce((sum, c) => sum + c.stats.blocked, 0);
  const malformed = categories.reduce((sum, c) => sum + c.stats.malformed, 0);
  const coerced = patchStats.coercedEnums;

  if (input === 0 && coerced === 0) return null;

  const hasWarning = blocked > 0 || coerced > 0;

  return (
    <div
      className={`mb-2.5 rounded-lg border p-2.5 text-[10px] ${
        hasWarning
          ? 'border-ember/40 bg-ember/5 text-parchment-100'
          : 'border-gold/20 bg-ink/40 text-parchment-200/75'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-serif tracking-[0.12em] text-gold-light">
          <Sparkles size={11} className="text-gold" />
          <span>司书状态对账（Patch Ledger）</span>
        </div>
        <div className="font-mono tabular-nums text-[10px]">
          <span className="text-moss-light">采纳 {applied}/{input}</span>
          {blocked > 0 && (
            <span className="ml-2 text-ember-light">
              · 拦截 {blocked}（缺字段 {malformed}）
            </span>
          )}
          {coerced > 0 && (
            <span className="ml-2 text-gold-light">
              · 枚举修正 {coerced}
            </span>
          )}
          {!hasWarning && <span className="ml-2 text-parchment-200/45">· 零拦截、零改写</span>}
        </div>
      </div>

      {/* 五维微缩账格 */}
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {categories.map(({ key, label, code, stats }) => {
          const active = stats.input > 0;
          const itemWarn = stats.blocked > 0;
          return (
            <div
              key={key}
              className={`rounded border px-2 py-1 text-center transition ${
                itemWarn
                  ? 'border-ember/45 bg-ember/10'
                  : active
                    ? 'border-gold/30 bg-gold/10'
                    : 'border-parchment-600/15 bg-ink/30 opacity-50'
              }`}
            >
              <div className="flex items-center justify-between text-[9px] text-parchment-200/50">
                <span>{label}</span>
                <span className="font-mono text-[8px] opacity-65">{code}</span>
              </div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-parchment-100">
                {stats.applied}
                <span className="text-parchment-200/40">/{stats.input}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface ModelActivityPanelProps {
  activities: ModelActivityV2[];
  thinking: Record<ModelPhaseV2, string>;
  busy: boolean;
  patchStats?: PatchStatsV2;
}

export function ModelActivityPanel({
  activities,
  thinking,
  busy,
  patchStats,
}: ModelActivityPanelProps) {
  const [open, setOpen] = useState(true);
  const [phaseOpen, setPhaseOpen] = useState<Record<ModelPhaseV2, boolean>>({
    planner_pre: true,
    story: false,
    planner_post: false,
  });
  const [copiedPhase, setCopiedPhase] = useState<ModelPhaseV2 | null>(null);
  const previousBusy = useRef(false);

  const phases = (['planner_pre', 'story', 'planner_post'] as ModelPhaseV2[]).map((phase) => {
    const events = activities.filter((item) => item.type === 'phase' && item.phase === phase);
    const phaseTools = activities.filter((item) => item.type === 'tool' && item.phase === phase);
    const phaseWarnings = activities.filter((item) => item.type === 'warning' && item.phase === phase);
    const usageEvents = activities.filter((item) => item.type === 'usage' && item.phase === phase);
    const usageEvent = usageEvents[usageEvents.length - 1];
    return {
      phase,
      latest: events[events.length - 1],
      tools: phaseTools,
      warnings: phaseWarnings,
      usage: usageEvent?.type === 'usage' ? usageEvent.usage : undefined,
    };
  });

  const totalUsage = sumUsage(phases.map(({ usage }) => usage));
  const active = phases.find(({ latest }) => latest?.type === 'phase' && latest.status === 'started')?.phase;

  useEffect(() => {
    if (busy && !previousBusy.current) {
      setOpen(true);
      setPhaseOpen({ planner_pre: true, story: false, planner_post: false });
    }
    previousBusy.current = busy;
  }, [busy]);

  useEffect(() => {
    if (active) {
      setPhaseOpen((current) => (current[active] ? current : { ...current, [active]: true }));
    }
  }, [active]);

  if (!activities.length && !busy) return null;

  const totalRate = formatCacheHitRate(totalUsage);
  const totalTok = totalUsage?.totalTokens ?? ((totalUsage?.promptTokens ?? 0) + (totalUsage?.completionTokens ?? 0));

  const handleCopyThinking = (phase: ModelPhaseV2, text: string) => {
    if (!text) return;
    if (copyTextSafe(text)) {
      setCopiedPhase(phase);
      window.setTimeout(() => setCopiedPhase((cur) => (cur === phase ? null : cur)), 1500);
    }
  };

  return (
    <section className="relative mb-5 overflow-hidden rounded-xl border border-gold/30 bg-gradient-to-b from-parchment-900/75 via-parchment-900/55 to-ink/80 shadow-[0_10px_30px_rgba(0,0,0,0.38)]">
      {/* 顶部微光扫描金线（仅在模型运行时流动） */}
      <div
        className={`h-[1.5px] w-full ${
          busy
            ? 'bg-gold-foil bg-[length:200%_100%] animate-shimmer'
            : 'bg-gold-line opacity-45'
        }`}
      />

      {/* 控制台主头部：可点击展开/收起，同时常驻三阶段星轨脉冲条 */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-parchment-700/20"
      >
        <div className="flex min-w-0 items-center gap-3">
          <AstrolabeDial busy={busy} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-serif text-sm tracking-[0.1em] text-gold-light">
                {active ? PHASE_LABEL[active] : '司辰仪 · 本轮模型活动'}
              </span>
              <span className="hidden rounded border border-gold/25 bg-ink/55 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-gold/75 sm:inline">
                {busy ? '生成中' : '已完成'}
              </span>
            </div>
            <span className="mt-0.5 block truncate text-xs text-parchment-200/50">
              {busy
                ? '正在写这一回合的故事…'
                : '这一回合的故事已经写好了'}
            </span>
          </div>
        </div>

        {/* 右侧：三阶段星轨节点条 + 汇总药丸 */}
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-1.5 rounded-full border border-parchment-600/30 bg-ink/55 px-3 py-1 md:flex">
            {phases.map(({ phase, latest }, idx) => {
              const status = latest?.type === 'phase' ? latest.status : undefined;
              const shortLabel = phase === 'planner_pre' ? '规划' : phase === 'story' ? '书写' : '结算';
              return (
                <div key={phase} className="flex items-center gap-1.5">
                  {idx > 0 && (
                    <span
                      className={`h-px w-4 transition-colors ${
                        status === 'completed' || status === 'started'
                          ? 'bg-gold/70'
                          : 'bg-parchment-600/35'
                      }`}
                    />
                  )}
                  <span
                    className={`flex items-center gap-1 text-[11px] ${
                      status === 'started'
                        ? 'text-gold-light font-semibold'
                        : status === 'completed'
                          ? 'text-moss-light'
                          : status === 'failed'
                            ? 'text-blood'
                            : 'text-parchment-200/35'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        status === 'started'
                          ? 'bg-gold-light animate-ping'
                          : status === 'completed'
                            ? 'bg-moss-light'
                            : status === 'failed'
                              ? 'bg-blood'
                              : 'bg-parchment-600/50'
                      }`}
                    />
                    <span>{shortLabel}</span>
                  </span>
                </div>
              );
            })}
          </div>

          {totalTok > 0 && (
            <div className="hidden rounded-md border border-gold/20 bg-gold/5 px-2 py-1 font-mono text-[10px] tabular-nums text-gold/85 sm:block">
              {totalRate ? `${totalRate} · ` : ''}
              {tokenCount(totalTok)} tok
            </div>
          )}

          {open ? (
            <ChevronDown size={15} className="text-gold/70" />
          ) : (
            <ChevronRight size={15} className="text-gold/70" />
          )}
        </div>
      </button>

      {/* 展开详情区 */}
      {open && (
        <div className="border-t border-parchment-600/25 px-4 py-3.5">
          {totalUsage && (
            <div className="mb-3.5">
              <UsageLine usage={totalUsage} total />
            </div>
          )}

          {/* 三阶段星轨时间轴 */}
          <div className="relative ml-2.5 border-l border-gold/25 pl-5 space-y-3">
            {phases.map(({ phase, latest, tools, warnings, usage }) => {
              const status = latest?.type === 'phase' ? latest.status : undefined;
              const expanded = phaseOpen[phase];
              const meta = PHASE_META[phase];
              const phaseThinking = thinking[phase] || '';
              const thinkingChars = phaseThinking.length;
              const StatusIcon =
                status === 'started'
                  ? Loader2
                  : status === 'completed'
                    ? Check
                    : status === 'failed'
                      ? AlertCircle
                      : Circle;

              return (
                <div key={phase} className="relative">
                  {/* 时间轴左侧星轨节点 */}
                  <span
                    className={`absolute -left-[29px] top-3 flex h-4 w-4 items-center justify-center rounded-full border bg-parchment-900 ${
                      status === 'started'
                        ? 'border-gold-light text-gold-light shadow-glow-sm'
                        : status === 'completed'
                          ? 'border-moss/60 text-moss-light'
                          : status === 'failed'
                            ? 'border-blood text-blood'
                            : 'border-parchment-600/40 text-parchment-200/25'
                    }`}
                  >
                    <StatusIcon
                      size={10}
                      className={status === 'started' ? 'animate-spin' : undefined}
                    />
                  </span>

                  <div
                    className={`overflow-hidden rounded-lg border transition-colors ${
                      status === 'started'
                        ? 'border-gold/45 bg-gold/[0.06] shadow-[0_0_20px_rgba(201,165,102,0.08)]'
                        : 'border-parchment-600/20 bg-ink/30'
                    }`}
                  >
                    {/* 阶段卡片头部 */}
                    <button
                      type="button"
                      onClick={() => setPhaseOpen((current) => ({ ...current, [phase]: !current[phase] }))}
                      className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left transition hover:bg-parchment-700/15"
                    >
                      {expanded ? (
                        <ChevronDown size={13} className="text-parchment-200/50" />
                      ) : (
                        <ChevronRight size={13} className="text-parchment-200/50" />
                      )}

                      <span className="rounded border border-gold/25 bg-ink/50 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-gold/80">
                        {meta.code}
                      </span>

                      <span className="font-serif text-xs text-gold-light">
                        {meta.roleTitle} · {PHASE_LABEL[phase]}
                      </span>

                      {latest?.type === 'phase' && latest.model && (
                        <span className="rounded bg-parchment-800/70 px-1.5 py-0.5 font-mono text-[10px] text-parchment-200/45">
                          {latest.model}
                        </span>
                      )}

                      <div className="ml-auto flex items-center gap-2">
                        {thinkingChars > 0 && (
                          <span className="font-mono text-[10px] tabular-nums text-parchment-200/45">
                            思考 {thinkingChars.toLocaleString('zh-CN')} 字
                          </span>
                        )}
                        {tools.length > 0 && (
                          <span className="rounded border border-gold/30 bg-gold/10 px-1.5 py-0.5 font-mono text-[9px] text-gold-light">
                            工具 ×{tools.length}
                          </span>
                        )}
                        <span
                          className={`text-[10px] ${
                            status === 'started'
                              ? 'text-gold-light animate-pulse'
                              : status === 'completed'
                                ? 'text-moss-light'
                                : status === 'failed'
                                  ? 'text-blood'
                                  : 'text-parchment-200/40'
                          }`}
                        >
                          {status === 'started'
                            ? '推演中…'
                            : status === 'completed'
                              ? '已落定'
                              : status === 'failed'
                                ? '异常中断'
                                : '候命'}
                        </span>
                      </div>
                    </button>

                    {/* 阶段展开内容 */}
                    {expanded && (
                      <div className="border-t border-parchment-600/15 px-3 pb-3 pt-2.5">
                        <div className="mb-2 text-[11px] text-parchment-200/45">
                          {meta.subtitle}
                        </div>

                        {latest?.type === 'phase' && latest.error && (
                          <div className="mb-2.5 rounded border border-blood/45 bg-blood/10 p-2 whitespace-pre-wrap text-[11px] leading-5 text-blood">
                            {latest.error}
                          </div>
                        )}

                        {usage && (
                          <div className="mb-2.5">
                            <UsageLine usage={usage} />
                          </div>
                        )}

                        {phase === 'planner_post' && patchStats && (
                          <PatchReconciliationMatrix patchStats={patchStats} />
                        )}

                        {warnings.length > 0 && (
                          <div className="mb-2.5 space-y-1">
                            {warnings.map(
                              (warning, warningIndex) =>
                                warning.type === 'warning' && (
                                  <div
                                    key={`${warning.code}-${warning.path}-${warningIndex}`}
                                    className="flex items-start gap-1.5 rounded border border-ember/35 bg-ember/10 px-2.5 py-1.5 text-[10px] leading-4 text-parchment-100"
                                  >
                                    <AlertCircle size={11} className="mt-0.5 shrink-0 text-ember-light" />
                                    <span className="font-mono text-[9px] text-ember-light">[{warning.code}]</span>
                                    <span>{warning.message}</span>
                                  </div>
                                ),
                            )}
                          </div>
                        )}

                        {/* 思考链「窥镜」视窗 */}
                        <div className="overflow-hidden rounded-lg border border-parchment-600/25 bg-ink/60 shadow-inset-deep">
                          <div className="flex items-center justify-between border-b border-parchment-600/20 bg-parchment-900/60 px-2.5 py-1 text-[10px] text-parchment-200/45">
                            <span className="font-mono tracking-wider">
                              THINKING TRACE · {status === 'started' ? 'STREAMING' : 'SNAPSHOT'}
                            </span>
                            {phaseThinking && (
                              <button
                                type="button"
                                onClick={() => handleCopyThinking(phase, phaseThinking)}
                                className="rounded px-1.5 py-0.5 text-[10px] text-gold/75 transition hover:bg-gold/10 hover:text-gold-light"
                              >
                                {copiedPhase === phase ? '✓ 已复制' : '复制思考链'}
                              </button>
                            )}
                          </div>
                          <div
                            className={`max-h-60 overflow-auto px-3 py-2.5 whitespace-pre-wrap font-serif text-xs leading-6 text-parchment-200/70 ${
                              status === 'started' && phaseThinking ? 'caret' : ''
                            }`}
                          >
                            {phaseThinking ||
                              (status === 'started'
                                ? '正在调阅世界书与近期上下文并推演…'
                                : status === 'completed'
                                  ? '此阶段未返回可显示的思考链内容。'
                                  : '等待上一阶段推演完成。')}
                          </div>
                        </div>

                        {/* 工具调用轨迹 */}
                        {tools.length > 0 && (
                          <div className="mt-3 space-y-2 border-l border-gold/30 pl-3">
                            {tools.map(
                              (tool, toolIndex) =>
                                tool.type === 'tool' && (
                                  <div
                                    key={`${tool.callId}-${tool.status}-${toolIndex}`}
                                    className="rounded border border-parchment-600/20 bg-ink/40 p-2 text-[11px] text-parchment-200/65"
                                  >
                                    <div className="flex items-center justify-between gap-1.5 text-gold-light">
                                      <span className="flex items-center gap-1.5">
                                        <Wrench size={11} />
                                        <span className="font-mono text-[10px]">
                                          {tool.status === 'call' ? 'CALL' : 'RETURN'} · {tool.toolName}
                                        </span>
                                      </span>
                                      <span className="font-mono text-[9px] text-parchment-200/35">
                                        {tool.callId}
                                      </span>
                                    </div>
                                    {tool.argumentsText && (
                                      <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-ink/70 p-2 font-mono text-[10px] text-parchment-200/70">
                                        {tool.argumentsText}
                                      </pre>
                                    )}
                                    {tool.resultText && (
                                      <pre className="mt-1.5 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-ink/70 p-2 font-mono text-[10px] text-parchment-200/70">
                                        {tool.resultText}
                                      </pre>
                                    )}
                                  </div>
                                ),
                            )}
                          </div>
                        )}

                        {!tools.length && latest?.type === 'phase' && latest.toolsEnabled && (
                          <div className="mt-2 flex items-center gap-1 text-[10px] text-parchment-200/30">
                            <Wrench size={10} /> 本阶段未触发外部工具调用
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}