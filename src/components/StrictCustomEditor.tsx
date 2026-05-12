import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Input';
import { OrnateDivider } from '@/components/ui/Ornaments';
import { useStrictCustomStore } from '@/store/useStrictCustomStore';
import { clsx } from '@/lib/utils';
import type { StrictCustomConfig } from '@/types/custom';
import {
  COMPACT_STORY_SYSTEM_TEMPLATE,
  DEEPSEEK_COMPAT_STORY_SYSTEM_TEMPLATE,
  DEFAULT_DECISION_USER_TEMPLATE,
  DEFAULT_STORY_SYSTEM_TEMPLATE,
  DEFAULT_STORY_USER_TEMPLATE,
  FOCUSED_STORY_USER_TEMPLATE,
} from '@/lib/strictCustom';
import { DECISION_SYSTEM } from '@/prompts/decisionSystem';

interface StrictCustomEditorProps {
  title?: string;
  description?: string;
  config?: StrictCustomConfig;
  update?: (patch: Partial<StrictCustomConfig>) => void;
  reset?: () => void;
  showEnableToggle?: boolean;
  enableLabel?: string;
  enableDescription?: string;
}

export function StrictCustomEditor(props: StrictCustomEditorProps = {}) {
  const store = useStrictCustomStore();
  const config = props.config ?? store.config;
  const update = props.update ?? store.update;
  const reset = props.reset ?? store.reset;
  const showEnableToggle = props.showEnableToggle ?? true;
  const title = props.title ?? '严格自定义模式';
  const description = props.description ?? '用更高优先级的导演提示控制故事节奏、隐藏设定揭示和选项偏好。启用后，新创建的旅程会固化当前配置。';

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="font-serif text-2xl text-gold-light">{title}</h2>
          <div className="text-sm text-parchment-200/70 leading-relaxed mt-1">
            {description}
          </div>
        </div>
        <Button variant="outline" onClick={reset}>
          <RotateCcw size={14} /> 恢复默认
        </Button>
      </div>

      {showEnableToggle ? (
        <Card className={clsx('mb-5', config.enabled && 'border-gold/70 shadow-glow-sm')}>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
              className="mt-1 accent-gold"
            />
            <div>
              <CardTitle className="mb-1">{props.enableLabel ?? '启用严格自定义'}</CardTitle>
              <CardMeta>
                {props.enableDescription ?? '开启后，新旅程会注入上方规则和选项偏好；提示词链路模板是否覆盖由下方独立开关控制。'}
              </CardMeta>
            </div>
          </label>
        </Card>
      ) : (
        <Card className="mb-5 border-gold/70 shadow-glow-sm">
          <CardTitle className="mb-1">执笔链路已启用</CardTitle>
          <CardMeta>
            执笔模式会固化并使用下方独立提示词链路；当前版本先复制原严格自定义链路，后续可继续扩展专属模型与提示词。
          </CardMeta>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Textarea
          label="全局叙事约束"
          value={config.globalPrompt}
          onChange={(e) => update({ globalPrompt: e.target.value })}
          rows={4}
          hint="控制玩家意图、主角行动边界、解决方案是否可提前出现。"
        />
        <Textarea
          label="推进粒度"
          value={config.pacingPrompt}
          onChange={(e) => update({ pacingPrompt: e.target.value })}
          rows={4}
          hint="控制每回合推进多少剧情，尤其适合等待/观察/试探类行动。"
        />
        <Textarea
          label="隐藏设定揭示规则"
          value={config.revealPrompt}
          onChange={(e) => update({ revealPrompt: e.target.value })}
          rows={4}
          hint="控制能力、身份、幕后真相何时才能写进正文。"
        />
        <Textarea
          label="选项生成偏好"
          value={config.choicePrompt}
          onChange={(e) => update({ choicePrompt: e.target.value })}
          rows={4}
          hint="会影响决策模型生成选项的范围和倾向。"
        />
      </div>

      <OrnateDivider>提示词链路覆盖</OrnateDivider>
      <Card className={clsx('mb-4', config.promptOverrideEnabled && 'border-gold/70 shadow-glow-sm')}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.promptOverrideEnabled}
            onChange={(e) => update({ promptOverrideEnabled: e.target.checked })}
            className="mt-1 accent-gold"
          />
          <div>
            <CardTitle className="mb-1">启用 system / user 模板覆盖</CardTitle>
            <CardMeta>
              默认关闭：严格自定义只把上方规则块注入项目最新默认提示词，不会意外覆盖最近加入的故事模式、DeepSeek V4 marker 和辅助模型链路。
              打开后，下方四个模板会直接替换对应模型的 system / user prompt。
            </CardMeta>
          </div>
        </label>
      </Card>
      <div className="text-sm text-parchment-200/70 leading-relaxed mb-3">
        下方文本框默认只是草稿；只有打开「启用 system / user 模板覆盖」后才会成为实际请求模板。清空某项会自动回退到项目默认模板。
        故事模板常用变量：
        <code className="text-gold/80 mx-1">{'{{round}}'}</code>
        <code className="text-gold/80 mx-1">{'{{roundInfo}}'}</code>
        <code className="text-gold/80 mx-1">{'{{strictCustomBlock}}'}</code>
        <code className="text-gold/80 mx-1">{'{{defaultUserMessage}}'}</code>
        <code className="text-gold/80 mx-1">{'{{input}}'}</code>。
        决策 User 模板常用
        <code className="text-gold/80 mx-1">{'{{latestStory}}'}</code>
        <code className="text-gold/80 mx-1">{'{{backpackSummary}}'}</code>
        <code className="text-gold/80 mx-1">{'{{strictCustomDecisionBlock}}'}</code>
        <code className="text-gold/80 mx-1">{'{{defaultDecisionUserPrompt}}'}</code>。
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => update({ storySystemPrompt: DEFAULT_STORY_SYSTEM_TEMPLATE })}
        >
          载入故事完整模板
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => update({ storySystemPrompt: DEEPSEEK_COMPAT_STORY_SYSTEM_TEMPLATE })}
        >
          载入 DeepSeek 兼容故事模板
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => update({ storySystemPrompt: COMPACT_STORY_SYSTEM_TEMPLATE })}
        >
          载入故事精简模板
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => update({ storyUserPrompt: DEFAULT_STORY_USER_TEMPLATE })}
        >
          载入默认 Story User
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => update({ storyUserPrompt: FOCUSED_STORY_USER_TEMPLATE })}
        >
          载入聚焦推进 Story User
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => update({ decisionSystemPrompt: DECISION_SYSTEM, decisionUserPrompt: DEFAULT_DECISION_USER_TEMPLATE })}
        >
          载入决策默认模板
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Textarea
          label="故事模型 · System 提示词模板"
          value={config.storySystemPrompt}
          onChange={(e) => update({ storySystemPrompt: e.target.value })}
          rows={8}
          placeholder="默认显示项目原本的故事 system prompt；可直接在此编辑。"
          hint="覆盖开关打开后会直接作为故事模型 system prompt。建议保留 {{writingRulesBlock}} 以跟随故事提示词模式，保留 {{strictCustomBlock}} 以注入上方严格规则。"
        />
        <Textarea
          label="故事模型 · User 提示词模板"
          value={config.storyUserPrompt}
          onChange={(e) => update({ storyUserPrompt: e.target.value })}
          rows={8}
          placeholder="默认：{{defaultUserMessage}}"
          hint="会直接作为每回合故事请求的 user 消息。{{defaultUserMessage}} 包含玩家输入、能力使用和重新生成参考。"
        />
        <Textarea
          label="决策模型 · System 提示词模板"
          value={config.decisionSystemPrompt}
          onChange={(e) => update({ decisionSystemPrompt: e.target.value })}
          rows={8}
          placeholder="默认显示项目原本的决策 system prompt；可直接在此编辑。"
          hint="覆盖开关打开后会直接作为决策模型 system prompt。建议保留 JSON 输出协议，避免选项解析失败。"
        />
        <Textarea
          label="决策模型 · User 提示词模板"
          value={config.decisionUserPrompt}
          onChange={(e) => update({ decisionUserPrompt: e.target.value })}
          rows={8}
          placeholder="默认显示项目原本的决策 user prompt；可直接在此编辑。"
          hint="覆盖开关打开后会直接作为决策模型 user prompt。保留 {{strictCustomDecisionBlock}} 才会让上方选项生成偏好参与请求。"
        />
      </div>
    </div>
  );
}
