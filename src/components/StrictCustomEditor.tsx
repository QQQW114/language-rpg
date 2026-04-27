import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import { OrnateDivider } from '@/components/ui/Ornaments';
import { useStrictCustomStore } from '@/store/useStrictCustomStore';
import { clsx } from '@/lib/utils';

export function StrictCustomEditor() {
  const { config, update, reset, addDirective, updateDirective, removeDirective } = useStrictCustomStore();

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="font-serif text-2xl text-gold-light">严格自定义模式</h2>
          <div className="text-sm text-parchment-200/70 leading-relaxed mt-1">
            用更高优先级的导演提示控制故事节奏、隐藏设定揭示和指定回合内容。启用后，新创建的旅程会固化当前配置。
          </div>
        </div>
        <Button variant="outline" onClick={reset}>
          <RotateCcw size={14} /> 恢复默认
        </Button>
      </div>

      <Card className={clsx('mb-5', config.enabled && 'border-gold/70 shadow-glow-sm')}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="mt-1 accent-gold"
          />
          <div>
            <CardTitle className="mb-1">启用严格自定义</CardTitle>
            <CardMeta>
              开启后，下方规则会被注入故事/决策模型；关闭时仅作为草稿保存，不影响新旅程。
            </CardMeta>
          </div>
        </label>
      </Card>

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

      <OrnateDivider>详细大纲</OrnateDivider>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-sm text-parchment-200/70 leading-relaxed">
          可添加多个「从多少回合到多少回合」的提示词。程序会在对应回合自动注入。
        </div>
        <Button variant="outline" onClick={addDirective}>
          <Plus size={16} /> 添加定义项
        </Button>
      </div>

      <div className="space-y-4">
        {config.detailedOutline.map((item, index) => (
          <Card key={item.id} className="p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="font-serif text-gold-light">
                定义项 {index + 1}
                <span className="ml-2 text-xs text-parchment-200/60">
                  [{item.startRound}]-[{item.endRound}] 回合
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeDirective(item.id)}
                title="删除此定义项"
              >
                <Trash2 size={14} />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="起始回合"
                type="number"
                min={0}
                max={999}
                value={item.startRound}
                onChange={(e) => updateDirective(item.id, { startRound: Number(e.target.value) || 0 })}
              />
              <Input
                label="结束回合"
                type="number"
                min={0}
                max={999}
                value={item.endRound}
                onChange={(e) => updateDirective(item.id, { endRound: Number(e.target.value) || item.startRound })}
              />
            </div>
            <Textarea
              label={`[${item.startRound}]-[${item.endRound}] 回合提示词`}
              value={item.prompt}
              onChange={(e) => updateDirective(item.id, { prompt: e.target.value })}
              rows={4}
              placeholder="主角：xxx；事件：xxx；风格：xxx；限制：xxx"
              hint="建议写清：本段该发生什么、不该发生什么、隐藏信息是否允许揭示、收束到哪个压力点。"
            />
          </Card>
        ))}

        {config.detailedOutline.length === 0 && (
          <Card className="text-sm text-parchment-200/70">
            尚未添加详细大纲。点击「添加定义项」创建例如：
            <span className="text-gold-light mx-1">[1]-[10] 回合：主角 xxx，事件 xxx，风格 xxx</span>
            的注入规则。
          </Card>
        )}
      </div>
    </div>
  );
}

