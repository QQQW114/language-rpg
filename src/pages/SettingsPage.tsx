import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Save as SaveIcon } from 'lucide-react';
import { useState } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Input';
import { OrnateDivider } from '@/components/ui/Ornaments';
import type {
  AppSettings,
  AuthorCallModelKey,
  AuthorCoreModelKey,
  AuthorModelRoutingSettings,
  StoryLength,
  StoryPromptMode,
} from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { clsx } from '@/lib/utils';

type SettingsTab = 'service' | 'models' | 'style';

const CORE_MODEL_OPTIONS: Array<{ key: AuthorCoreModelKey; label: string; hint: string }> = [
  { key: 'orchestrator', label: '回合司辰', hint: '调度层：判断本回合类型、工具与 calls 成员。' },
  { key: 'masterArc', label: '主弧规划员', hint: '开局 / 重建主弧阶段时使用。' },
  { key: 'directorReply', label: '叙事导演问询', hint: '故事写手用工具追问导演时使用。' },
];

const CALL_MODEL_OPTIONS: Array<{ key: AuthorCallModelKey; label: string; hint: string }> = [
  { key: 'outlineMapper', label: '大纲映射员', hint: '校准大纲、主弧与当前剧情的对应关系。' },
  { key: 'stageJudge', label: '阶段判断员', hint: '判断玩家意图、节奏与阶段推进。' },
  { key: 'settingGuard', label: '设定守护者', hint: '检查世界书、设定候选与偏离风险。' },
  { key: 'eventBeat', label: '司事 / 事件节奏', hint: '判定事件弧进退、关系与能力结算。' },
  { key: 'director', label: '叙事导演', hint: '汇总规划，产出 writing brief。' },
  { key: 'logicCheck', label: '逻辑审校员', hint: '审校连续性、时间线与修复指令。' },
  { key: 'memory', label: '记忆书吏', hint: '执笔模式下整理长期记忆。' },
  { key: 'summary', label: '摘要书吏', hint: '执笔模式下压缩上下文摘要。' },
];

function normalizeRouting(routing: AppSettings['authorModelRouting'] | undefined): AuthorModelRoutingSettings {
  return {
    ...DEFAULT_SETTINGS.authorModelRouting,
    ...(routing ?? {}),
    core: {
      ...DEFAULT_SETTINGS.authorModelRouting.core,
      ...(routing?.core ?? {}),
    },
    calls: {
      ...DEFAULT_SETTINGS.authorModelRouting.calls,
      ...(routing?.calls ?? {}),
    },
  };
}

export default function SettingsPage() {
  const nav = useNavigate();
  const { settings, update, reset } = useSettingsStore();
  const [draft, setDraft] = useState<AppSettings>({
    ...DEFAULT_SETTINGS,
    ...settings,
    authorModelRouting: normalizeRouting(settings.authorModelRouting),
  });
  const [tab, setTab] = useState<SettingsTab>('service');
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const setRouting = (patch: Partial<AuthorModelRoutingSettings>) => {
    setDraft((d) => ({
      ...d,
      authorModelRouting: {
        ...normalizeRouting(d.authorModelRouting),
        ...patch,
        core: {
          ...normalizeRouting(d.authorModelRouting).core,
          ...(patch.core ?? {}),
        },
        calls: {
          ...normalizeRouting(d.authorModelRouting).calls,
          ...(patch.calls ?? {}),
        },
      },
    }));
  };

  const setCoreModel = (key: AuthorCoreModelKey, value: string) => {
    const routing = normalizeRouting(draft.authorModelRouting);
    setRouting({ core: { ...routing.core, [key]: value.trim() } });
  };

  const setCallModel = (key: AuthorCallModelKey, value: string) => {
    const routing = normalizeRouting(draft.authorModelRouting);
    setRouting({ calls: { ...routing.calls, [key]: value.trim() } });
  };

  const save = () => {
    update({
      ...draft,
      authorModelRouting: normalizeRouting(draft.authorModelRouting),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const resetAll = () => {
    reset();
    setDraft({
      ...DEFAULT_SETTINGS,
      authorModelRouting: normalizeRouting(DEFAULT_SETTINGS.authorModelRouting),
    });
  };

  const routing = normalizeRouting(draft.authorModelRouting);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" onClick={() => nav(-1)}>
          <ArrowLeft size={16} /> 返回
        </Button>
        <h1 className="font-serif text-2xl text-gold-light">设置</h1>
        <div className="w-16" />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 rounded-lg border border-parchment-600/35 bg-parchment-900/25 p-1">
        <TabOption
          label="服务接口"
          active={tab === 'service'}
          onClick={() => setTab('service')}
        />
        <TabOption
          label="模型分工"
          active={tab === 'models'}
          onClick={() => setTab('models')}
        />
        <TabOption
          label="故事风格"
          active={tab === 'style'}
          onClick={() => setTab('style')}
        />
      </div>

      <div className="bg-parchment-800/60 border border-parchment-600/40 rounded-lg p-6">
        {tab === 'service' && (
          <>
            <h2 className="font-serif text-lg text-gold-light mb-2">模型服务 · OpenAI 兼容接口</h2>
            <div className="text-xs text-parchment-200/70 mb-4 leading-relaxed">
              支持任何遵循 OpenAI <code className="text-gold/80">/v1/chat/completions</code> 协议的服务，例如
              DeepSeek（<code className="text-gold/80">https://api.deepseek.com/v1</code>）、
              Moonshot（<code className="text-gold/80">https://api.moonshot.cn/v1</code>）、
              通义千问（<code className="text-gold/80">https://dashscope.aliyuncs.com/compatible-mode/v1</code>）、
              OpenAI 本家等。API Key 仅保存在本地浏览器中。
            </div>

            <Input
              label="API Base URL"
              value={draft.apiBaseUrl}
              onChange={(e) => set('apiBaseUrl', e.target.value.trim())}
              placeholder="https://api.deepseek.com/v1"
            />
            <Input
              label="API Key"
              type="password"
              value={draft.apiKey}
              onChange={(e) => set('apiKey', e.target.value.trim())}
              placeholder="sk-..."
              hint="仅保存在本地 localStorage，不会上传。"
            />

            <Field label="请求格式" hint="标准 OpenAI/DeepSeek/Moonshot 等选 Chat Completions；OpenAI Codex / Responses API 代理选 Responses。">
              <div className="grid grid-cols-2 gap-2">
                <FormatOption
                  label="Chat Completions"
                  sub="/v1/chat/completions · 通用"
                  active={draft.apiFormat === 'chat'}
                  onClick={() => set('apiFormat', 'chat')}
                />
                <FormatOption
                  label="Responses"
                  sub="/v1/responses · OpenAI 新版"
                  active={draft.apiFormat === 'responses'}
                  onClick={() => set('apiFormat', 'responses')}
                />
              </div>
            </Field>

            <OrnateDivider>运行参数</OrnateDivider>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="故事 temperature"
                type="number"
                step="0.05"
                min={0}
                max={2}
                value={draft.temperatureStory}
                onChange={(e) => set('temperatureStory', Number(e.target.value) || 0.9)}
              />
              <Input
                label="决策 temperature"
                type="number"
                step="0.05"
                min={0}
                max={2}
                value={draft.temperatureDecision}
                onChange={(e) => set('temperatureDecision', Number(e.target.value) || 0.5)}
              />
            </div>
            <Input
              label="压缩阈值（消息条数）"
              type="number"
              min={12}
              max={60}
              value={draft.maxHistoryRounds}
              onChange={(e) => set('maxHistoryRounds', Number(e.target.value) || 22)}
              hint="历史消息超过此数后，早期消息会被自动压缩为摘要；建议 20~30，过小会频繁压缩导致模型遗忘细节"
            />
            <Input
              label="故事最大输出 tokens"
              type="number"
              min={0}
              step={256}
              value={draft.storyMaxTokens}
              onChange={(e) => set('storyMaxTokens', Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              hint="默认 4096。若模型因长度被截断，会自动续写并拼接；填 0 表示不传该参数，由服务端决定。"
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="长期记忆间隔（回合）"
                type="number"
                min={0}
                max={20}
                value={draft.memoryEveryRounds}
                onChange={(e) => set('memoryEveryRounds', Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                hint="每过 X 个已完成回合，在故事与决策完成后整理一次；0 表示关闭"
              />
              <Input
                label="长期记忆最大长度"
                type="number"
                min={800}
                max={12000}
                step={200}
                value={draft.memoryMaxChars}
                onChange={(e) => set('memoryMaxChars', Math.max(800, Math.floor(Number(e.target.value) || 4000)))}
                hint="记忆块最大字符数，越长越稳但会占上下文"
              />
            </div>
          </>
        )}

        {tab === 'models' && (
          <>
            <h2 className="font-serif text-lg text-gold-light mb-2">模型分工 · Agent 调度</h2>
            <div className="text-xs text-parchment-200/70 mb-4 leading-relaxed">
              基础模型仍作为全局默认；执笔模式 Agent 会优先读取本页的分工设置。
              <span className="text-gold/75">留空的工具 / calls / 司辰模型均回退到故事模型</span>，便于先用一个模型跑通，再逐步拆分。
            </div>

            <OrnateDivider>基础模型</OrnateDivider>
            <Input
              label="故事模型"
              value={draft.storyModel}
              onChange={(e) => set('storyModel', e.target.value.trim())}
              placeholder="deepseek-chat"
              hint="所有未指定的 Agent 模型都会回退到这里；也是正文故事写手使用的模型。"
            />
            <Input
              label="决策模型"
              value={draft.decisionModel}
              onChange={(e) => set('decisionModel', e.target.value.trim())}
              placeholder="deepseek-chat"
              hint="游历模式 / 选项与状态记录 JSON 默认使用。执笔模式 calls 成员不再默认走它。"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input
                label="摘要模型（旧链路可选）"
                value={draft.summaryModel ?? ''}
                onChange={(e) => set('summaryModel', e.target.value.trim())}
                placeholder="留空则使用故事模型"
                hint="非执笔模式或旧摘要链路使用。"
              />
              <Input
                label="长期记忆模型（旧链路可选）"
                value={draft.memoryModel ?? ''}
                onChange={(e) => set('memoryModel', e.target.value.trim())}
                placeholder="留空则使用摘要/故事模型"
                hint="非执笔模式记忆整理使用。"
              />
              <Input
                label="随机生成模型（旧链路可选）"
                value={draft.randomModel ?? ''}
                onChange={(e) => set('randomModel', e.target.value.trim())}
                placeholder="留空则使用摘要/故事模型"
                hint="随机大纲、出身、开局等一次性生成使用。"
              />
            </div>

            <OrnateDivider>工具模型</OrnateDivider>
            <ModelRouteInput
              label="A 类工具模型统一使用"
              value={routing.toolModel}
              onChange={(value) => setRouting({ toolModel: value.trim() })}
              placeholder={`留空则使用 ${draft.storyModel || '故事模型'}`}
              hint="人物规划员 / 场景规划员 / 事件规划员作为司辰工具被调用时，统一使用这里的模型。"
            />

            <OrnateDivider>调度层 / 核心模型</OrnateDivider>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {CORE_MODEL_OPTIONS.map((item) => (
                <ModelRouteInput
                  key={item.key}
                  label={item.label}
                  value={routing.core[item.key]}
                  onChange={(value) => setCoreModel(item.key, value)}
                  placeholder={`留空则使用 ${draft.storyModel || '故事模型'}`}
                  hint={item.hint}
                />
              ))}
            </div>

            <OrnateDivider>Calls 成员模型</OrnateDivider>
            <div className="text-xs text-parchment-200/60 mb-3 leading-relaxed">
              Calls 是回合司辰决定“本回合正式参与故事生成”的成员模型；这些模型会写入记录并影响故事前的规划。
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {CALL_MODEL_OPTIONS.map((item) => (
                <ModelRouteInput
                  key={item.key}
                  label={item.label}
                  value={routing.calls[item.key]}
                  onChange={(value) => setCallModel(item.key, value)}
                  placeholder={`留空则使用 ${draft.storyModel || '故事模型'}`}
                  hint={item.hint}
                />
              ))}
            </div>
          </>
        )}

        {tab === 'style' && (
          <>
            <h2 className="font-serif text-lg text-gold-light mb-2">故事风格</h2>
            <div className="text-xs text-parchment-200/70 mb-4 leading-relaxed">
              这里影响故事写手的正文输出；旅程内单独配置的故事风格会覆盖全局篇幅和追加提示。
            </div>

            <Field label="篇幅偏好" hint="每回合故事的大致字数区间">
              <div className="grid grid-cols-3 gap-2">
                {(['short', 'standard', 'long'] as StoryLength[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set('storyLength', v)}
                    className={clsx(
                      'rounded-md border px-3 py-2 text-sm transition-all font-serif',
                      draft.storyLength === v
                        ? 'border-gold shadow-glow-sm bg-parchment-900/60 text-gold-light'
                        : 'border-parchment-600/40 hover:border-gold/60 bg-parchment-900/30 text-parchment-100',
                    )}
                  >
                    {v === 'short' && '短 · 140~260 字'}
                    {v === 'standard' && '标准 · 220~420 字'}
                    {v === 'long' && '长 · 360~600 字'}
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="故事提示词模式"
              hint="用于切换故事模型的叙述视角与 DeepSeek V4 特化；默认模式保留原有第二人称。"
            >
              <div className="grid grid-cols-1 gap-2">
                {([
                  {
                    value: 'default',
                    label: '默认 · 第二人称',
                    sub: '保留原有提示词：故事主持人用“你”称呼玩家角色。',
                  },
                  {
                    value: 'deepseek-v4-protagonist',
                    label: 'DeepSeek V4 · 主角特化',
                    sub: '角色沉浸特化；正文改用第一人称“我”。',
                  },
                  {
                    value: 'deepseek-v4-instruction',
                    label: 'DeepSeek V4 · 指令遵循特化',
                    sub: '指令遵循特化；正文改用主角姓名第三人称，降低擅自代入主角的概率。',
                  },
                ] as Array<{ value: StoryPromptMode; label: string; sub: string }>).map((option) => (
                  <FormatOption
                    key={option.value}
                    label={option.label}
                    sub={option.sub}
                    active={draft.storyPromptMode === option.value}
                    onClick={() => set('storyPromptMode', option.value)}
                  />
                ))}
              </div>
            </Field>
            <Textarea
              label="自定义风格提示（追加到故事系统提示）"
              value={draft.storyStyleAddendum}
              onChange={(e) => set('storyStyleAddendum', e.target.value)}
              placeholder={'示例：\n- 多用感官细节（气味、触感、光线），少用对话\n- 允许偶尔使用主角内心独白\n- 禁止玻璃/镜子相关意象'}
              rows={5}
              hint="会被追加到故事模型的系统提示末尾，可用于约束文风、词汇禁用、意象偏好等。留空则无追加。"
            />
          </>
        )}

        <div className="flex justify-between mt-6 pt-4 border-t border-parchment-600/40">
          <Button variant="outline" onClick={resetAll}>
            <RotateCcw size={14} /> 恢复默认
          </Button>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-gold-light animate-fade-in">已保存 ✓</span>}
            <Button onClick={save}>
              <SaveIcon size={16} /> 保存
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-md px-3 py-2 text-sm font-serif transition-all',
        active
          ? 'bg-parchment-800/75 text-gold-light shadow-glow-sm'
          : 'text-parchment-200/65 hover:text-gold-light hover:bg-parchment-800/35',
      )}
    >
      {label}
    </button>
  );
}

function ModelRouteInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint: string;
}) {
  return (
    <Input
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      hint={hint}
    />
  );
}

function FormatOption({
  label,
  sub,
  active,
  onClick,
}: {
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-md border px-3 py-2 transition-all ${
        active
          ? 'border-gold shadow-glow-sm bg-parchment-900/60'
          : 'border-parchment-600/40 hover:border-gold/60 bg-parchment-900/30'
      }`}
    >
      <div className={`font-serif ${active ? 'text-gold-light' : 'text-parchment-100'}`}>{label}</div>
      <div className="text-xs text-parchment-200/60 mt-0.5">{sub}</div>
    </button>
  );
}
