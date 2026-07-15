import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useSettingsStore } from '@/store/useSettingsStore';
import {
  PLANNER_CONTEXT_PRESET_TOKENS,
  type PlannerContextPreset,
} from '@/types/settings';
import { Card } from '@/components/ui/Card';
import { CornerFiligree, OrnateDivider } from '@/components/ui/Ornaments';
import { TextStarfield } from '@/components/TextStarfield';
import { ArrowLeft, ChevronDown, ChevronRight, Save, Search, Settings } from 'lucide-react';

const contextOptions: Array<{
  id: PlannerContextPreset;
  label: string;
  value?: number;
  description: string;
}> = [
  {
    id: 'compact',
    label: '精简',
    value: PLANNER_CONTEXT_PRESET_TOKENS.compact,
    description: '更低延迟与消耗，适合短故事或测试。',
  },
  {
    id: 'standard',
    label: '标准',
    value: PLANNER_CONTEXT_PRESET_TOKENS.standard,
    description: '兼顾近期细节、延迟与调用消耗。',
  },
  {
    id: 'rich',
    label: '丰富',
    value: PLANNER_CONTEXT_PRESET_TOKENS.rich,
    description: '保留更多近期正文，适合长线故事。',
  },
  {
    id: 'custom',
    label: '自定义',
    description: '手动指定近期正文的软预算。',
  },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { settings, update } = useSettingsStore();
  const [draft, setDraft] = useState(settings);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customTokens, setCustomTokens] = useState(String(settings.plannerContextTokens));
  const customTokenNumber = Number(customTokens);
  const customTokensValid = Number.isInteger(customTokenNumber)
    && customTokenNumber >= 4_096
    && customTokenNumber <= 1_000_000;

  const chooseContextPreset = (preset: PlannerContextPreset) => {
    const presetTokens = preset === 'custom' ? undefined : PLANNER_CONTEXT_PRESET_TOKENS[preset];
    setDraft((current) => ({
      ...current,
      plannerContextPreset: preset,
      plannerContextTokens: presetTokens ?? current.plannerContextTokens,
    }));
    if (preset !== 'custom' && presetTokens) setCustomTokens(String(presetTokens));
  };

  const saveSettings = () => {
    if (draft.plannerContextPreset === 'custom' && !customTokensValid) return;
    update({
      ...draft,
      plannerContextTokens: draft.plannerContextPreset === 'custom'
        ? customTokenNumber
        : draft.plannerContextTokens,
    });
    navigate(-1);
  };

  return (
    <div className="relative min-h-full overflow-hidden px-5 py-10">
      <TextStarfield autoImpulse={8} className="opacity-45" />
      <div className="relative z-10 mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft size={16} /> 返回</Button>
          <div className="text-xs tracking-[0.35em] text-gold/55">MODEL · SETTINGS</div>
        </div>
        <Card variant="engraved" className="relative overflow-hidden p-6 sm:p-8">
          <CornerFiligree className="absolute -left-4 -top-4 h-20 w-20" />
          <CornerFiligree className="absolute -right-4 -top-4 h-20 w-20 rotate-90" />
          <div className="mb-2 flex items-center gap-3">
            <Settings className="text-gold" size={24} />
            <h1 className="font-serif text-3xl tracking-widest text-gold-light">{'模型设置'}</h1>
          </div>
          <p className="text-sm leading-relaxed text-parchment-200/60">
            {'配置故事之笔与规划之镜。故事节奏由每个存档的游戏页面随时调整。'}
          </p>
          <OrnateDivider decoration="seal" />

      <Input
        label="API Base URL"
        value={draft.apiBaseUrl}
        onChange={(event) => setDraft({ ...draft, apiBaseUrl: event.target.value })}
      />
      <Input
        label="API Key"
        type="password"
        value={draft.apiKey}
        onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
        hint="仅保存在当前浏览器的本地存储中"
      />
      <Input
        label="规划模型"
        value={draft.plannerModel}
        onChange={(event) => setDraft({ ...draft, plannerModel: event.target.value })}
        hint="同一回合完成写前规划与写后状态结算"
      />

      <div className="mb-4 overflow-hidden rounded-md border border-parchment-600/45 bg-parchment-900/35">
        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-parchment-700/25"
        >
          <span>
            <span className="block text-sm tracking-[0.08em] text-gold-light">上下文与工具</span>
            <span className="mt-1 block text-xs text-parchment-200/55">
              {draft.plannerContextPreset === 'custom'
                ? `自定义 · ${customTokens || '—'} Token`
                : `${contextOptions.find((option) => option.id === draft.plannerContextPreset)?.label ?? '标准'} · ${draft.plannerContextTokens.toLocaleString()} Token`}
              {' · '}{draft.plannerToolsEnabled ? '查询工具偏好已开启' : '查询工具关闭'}
            </span>
          </span>
          {advancedOpen
            ? <ChevronDown size={17} className="shrink-0 text-gold/70" />
            : <ChevronRight size={17} className="shrink-0 text-gold/70" />}
        </button>

        {advancedOpen && (
          <div className="border-t border-parchment-600/35 px-4 py-4">
            <div className="mb-3">
              <div className="text-sm text-parchment-100">规划模型近期正文预算</div>
              <p className="mt-1 text-xs leading-relaxed text-parchment-200/55">
                Token 数是规划模型接收“近期故事正文”的软预算。世界书、大纲、人物关系和其他权威状态会单独保留；实际请求也会为系统指令、本轮输入与输出预留空间，因此不保证精确用满。
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {contextOptions.map((option) => {
                const selected = draft.plannerContextPreset === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => chooseContextPreset(option.id)}
                    className={`rounded-md border px-3 py-2.5 text-left transition-all ${selected
                      ? 'border-gold/70 bg-gold/10 shadow-[0_0_16px_rgba(201,165,102,0.08)]'
                      : 'border-parchment-600/40 bg-parchment-900/35 hover:border-parchment-500/70 hover:bg-parchment-700/20'}`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className={selected ? 'text-sm text-gold-light' : 'text-sm text-parchment-100'}>{option.label}</span>
                      {option.value && <span className="text-xs tabular-nums text-parchment-200/50">{(option.value / 1000).toFixed(0)}K</span>}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-parchment-200/50">{option.description}</span>
                  </button>
                );
              })}
            </div>

            {draft.plannerContextPreset === 'custom' && (
              <div className="mt-4">
                <Input
                  label="自定义 Token 数"
                  type="number"
                  min={4_096}
                  max={1_000_000}
                  step={1_000}
                  value={customTokens}
                  onChange={(event) => setCustomTokens(event.target.value)}
                  aria-invalid={!customTokensValid}
                  hint={customTokensValid
                    ? '允许 4,096～1,000,000；数值越大，调用延迟和消耗通常越高。'
                    : '请输入 4,096～1,000,000 之间的整数。'}
                />
              </div>
            )}

            <div className="mt-4 flex items-start justify-between gap-4 rounded-md border border-parchment-600/35 bg-ink/25 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Search size={15} className="text-gold/75" />
                  <span className="text-sm text-parchment-100">故事上下文查询工具</span>
                  <span className="rounded border border-gold/35 bg-gold/10 px-1.5 py-0.5 text-[10px] tracking-wider text-gold/75">实验性偏好</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-parchment-200/55">
                  开启后仅向规划模型开放 search_story_context，可按需检索旧正文、人物、关系、正史事实与故事线程；故事模型不会获得工具。通常最多查询两轮。
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.plannerToolsEnabled}
                aria-label="启用故事上下文查询工具偏好"
                onClick={() => setDraft((current) => ({
                  ...current,
                  plannerToolsEnabled: !current.plannerToolsEnabled,
                }))}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors ${draft.plannerToolsEnabled
                  ? 'border-gold/70 bg-gold/55'
                  : 'border-parchment-500/55 bg-parchment-800/80'}`}
              >
                <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-parchment-50 shadow transition-transform ${draft.plannerToolsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            {draft.plannerToolsEnabled && <div className="mt-3 rounded-md border border-gold/20 bg-gold/5 p-3">
              <Input
                label="单阶段工具调用最高数量"
                type="number"
                min={1}
                max={6}
                step={1}
                value={draft.plannerToolMaxCalls}
                onChange={(event) => setDraft({ ...draft, plannerToolMaxCalls: Math.max(1, Math.min(6, Number(event.target.value) || 1)) })}
                hint="写前规划和写后结算分别计算；建议2次，最高6次。达到上限后继续调用会返回上限提示。"
              />
            </div>}

            <div className="mt-4 rounded-md border border-parchment-600/35 bg-ink/20 p-3">
              <div className="text-sm text-parchment-100">DeepSeek兼容优化</div>
              <p className="mt-1 text-xs leading-relaxed text-parchment-200/55">自动模式只在官方DeepSeek地址启用专属参数；其他OpenAI兼容服务不发送未知字段。</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-parchment-200/65">规划JSON模式
                  <select value={draft.plannerJsonMode} onChange={(event) => setDraft({ ...draft, plannerJsonMode: event.target.value as typeof draft.plannerJsonMode })} className="mt-1 w-full rounded border border-parchment-600/40 bg-ink/50 px-2 py-2 text-parchment-100">
                    <option value="auto">自动（推荐）</option><option value="enabled">强制启用</option><option value="disabled">关闭</option>
                  </select>
                </label>
                <label className="text-xs text-parchment-200/65">思考模式
                  <select value={draft.thinkingMode} onChange={(event) => setDraft({ ...draft, thinkingMode: event.target.value as typeof draft.thinkingMode })} className="mt-1 w-full rounded border border-parchment-600/40 bg-ink/50 px-2 py-2 text-parchment-100">
                    <option value="auto">自动（推荐）</option><option value="enabled">启用</option><option value="disabled">关闭</option>
                  </select>
                </label>
                <label className="text-xs text-parchment-200/65 sm:col-span-2">思考强度
                  <select disabled={draft.thinkingMode === 'disabled'} value={draft.reasoningEffort} onChange={(event) => setDraft({ ...draft, reasoningEffort: event.target.value as typeof draft.reasoningEffort })} className="mt-1 w-full rounded border border-parchment-600/40 bg-ink/50 px-2 py-2 text-parchment-100 disabled:opacity-40">
                    <option value="high">High · 常规深度</option><option value="max">Max · 复杂规划/Agent任务</option>
                  </select>
                </label>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-parchment-200/45">DeepSeek当前不提供数字型思考Token预算，仅支持High与Max。JSON模式只用于规划模型，故事正文保持普通文本。</p>
            </div>
          </div>
        )}
      </div>

      <Input
        label="故事模型"
        value={draft.storyModel}
        onChange={(event) => setDraft({ ...draft, storyModel: event.target.value })}
        hint="只负责故事正文"
      />

          <div className="mt-7 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => navigate(-1)}>{'取消'}</Button>
            <Button
              disabled={draft.plannerContextPreset === 'custom' && !customTokensValid}
              onClick={saveSettings}
            >
              <Save size={16} /> {'保存设置'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
