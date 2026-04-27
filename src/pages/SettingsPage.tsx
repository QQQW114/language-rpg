import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save as SaveIcon, RotateCcw } from 'lucide-react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Input';
import { OrnateDivider } from '@/components/ui/Ornaments';
import { useState } from 'react';
import type { AppSettings, StoryLength } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { clsx } from '@/lib/utils';

export default function SettingsPage() {
  const nav = useNavigate();
  const { settings, update, reset } = useSettingsStore();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    update(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" onClick={() => nav(-1)}>
          <ArrowLeft size={16} /> 返回
        </Button>
        <h1 className="font-serif text-2xl text-gold-light">设置</h1>
        <div className="w-16" />
      </div>

      <div className="bg-parchment-800/60 border border-parchment-600/40 rounded-lg p-6">
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

        <OrnateDivider>模型</OrnateDivider>
        <Input
          label="故事模型"
          value={draft.storyModel}
          onChange={(e) => set('storyModel', e.target.value.trim())}
          placeholder="deepseek-chat"
          hint="用于推进剧情，建议选用上下文长、中文好的模型"
        />
        <Input
          label="决策模型"
          value={draft.decisionModel}
          onChange={(e) => set('decisionModel', e.target.value.trim())}
          placeholder="deepseek-chat"
          hint="用于生成选项 JSON，建议与故事模型一致"
        />
        <Input
          label="摘要模型（可选）"
          value={draft.summaryModel ?? ''}
          onChange={(e) => set('summaryModel', e.target.value.trim())}
          placeholder="留空则使用故事模型"
          hint="用于压缩超长历史为梗概"
        />
        <Input
          label="随机生成模型（可选）"
          value={draft.randomModel ?? ''}
          onChange={(e) => set('randomModel', e.target.value.trim())}
          placeholder="留空则使用摘要模型或故事模型"
          hint="用于随机大纲 / 出身 / 开局的一次性生成，若想让随机更发散可独立选一个创意更强的模型"
        />

        <OrnateDivider>高级</OrnateDivider>
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

        <OrnateDivider>故事风格</OrnateDivider>
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
        <Textarea
          label="自定义风格提示（追加到故事系统提示）"
          value={draft.storyStyleAddendum}
          onChange={(e) => set('storyStyleAddendum', e.target.value)}
          placeholder={'示例：\n- 多用感官细节（气味、触感、光线），少用对话\n- 允许偶尔使用主角内心独白\n- 禁止玻璃/镜子相关意象'}
          rows={5}
          hint="会被追加到故事模型的系统提示末尾，可用于约束文风、词汇禁用、意象偏好等。留空则无追加。"
        />

        <div className="flex justify-between mt-4 pt-4 border-t border-parchment-600/40">
          <Button variant="outline" onClick={() => { reset(); setDraft(DEFAULT_SETTINGS); }}>
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

function FormatOption({
  label, sub, active, onClick,
}: { label: string; sub: string; active: boolean; onClick: () => void }) {
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
