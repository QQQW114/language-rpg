import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import { OrnateDivider } from '@/components/ui/Ornaments';
import { AUTHOR_PRESETS, type AuthorPreset } from '@/presets/authorPresets';

export default function PresetsPage() {
  const nav = useNavigate();

  const launch = (preset: AuthorPreset) => {
    nav('/setup', {
      state: {
        preset: preset.preset,
      },
    });
  };

  return (
    <div className="min-h-full max-w-5xl mx-auto px-6 py-10 pb-24">
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" onClick={() => nav('/')}>
          <ArrowLeft size={16} /> 返回主页
        </Button>
        <div className="text-xs text-parchment-200/60 tracking-[0.3em] font-serif">
          PRESETS · 一键启程
        </div>
        <div className="w-20" />
      </div>

      <div className="text-center mb-2">
        <h1 className="font-serif text-4xl text-gold-light tracking-widest">
          <Sparkles size={20} className="inline mr-2 -mt-1" />
          执笔模式 · 预设故事
        </h1>
      </div>
      <div className="text-center text-sm text-parchment-200/70 font-serif mb-4">
        点击任意预设，即可跳过选大纲 / 选出身这两步，直接进入"启程设定"。
      </div>

      <OrnateDivider />

      <div className="grid gap-5 md:grid-cols-2 mt-8">
        {AUTHOR_PRESETS.map((preset) => (
          <Card
            key={preset.id}
            interactive
            onClick={() => launch(preset)}
            className="flex flex-col"
          >
            <CardTitle className="flex items-center gap-2">
              {preset.coverEmoji && <span className="text-xl">{preset.coverEmoji}</span>}
              <span>{preset.title}</span>
            </CardTitle>
            {preset.subtitle && <CardMeta>{preset.subtitle}</CardMeta>}
            <div className="text-sm text-parchment-100/90 leading-relaxed mb-3">
              {preset.description}
            </div>
            {preset.acts && preset.acts.length > 0 && (
              <ul className="text-xs text-parchment-200/70 space-y-1 mb-3">
                {preset.acts.map((act, idx) => (
                  <li key={idx} className="pl-3 border-l border-gold-dark/60 leading-relaxed">
                    {act}
                  </li>
                ))}
              </ul>
            )}
            {preset.tags && preset.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {preset.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[11px] px-2 py-0.5 rounded border border-gold/40 text-parchment-100 bg-parchment-900/40"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-auto pt-2 flex items-center justify-end text-gold-light text-xs tracking-wider">
              一键启程 <ChevronRight size={14} />
            </div>
          </Card>
        ))}
        {AUTHOR_PRESETS.length === 0 && (
          <div className="md:col-span-2 text-center text-parchment-200/60 py-12 font-serif">
            暂无可用预设。后续会陆续加入更多预设故事。
          </div>
        )}
      </div>
    </div>
  );
}
