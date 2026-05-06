import type { AdventureReview } from '@/types/game';
import { clsx } from '@/lib/utils';
import { OrnateDivider } from './ui/Ornaments';
import { Sparkles, Award, Quote } from 'lucide-react';
import { ThinkToggle } from '@/components/ThinkToggle';

const GRADE_COLOR: Record<AdventureReview['grade'], string> = {
  S: 'text-gold-light border-gold shadow-glow',
  A: 'text-gold border-gold/70 shadow-glow-sm',
  B: 'text-emerald-300 border-emerald-400/60',
  C: 'text-sky-300 border-sky-400/50',
  D: 'text-blood border-blood/60',
};

const DIM_LABEL: Record<keyof AdventureReview['scores'], string> = {
  narrative: '叙事',
  choices: '抉择',
  immersion: '沉浸',
  completion: '完成度',
};

interface ReviewPanelProps {
  review?: AdventureReview;
  loading?: boolean;
  onRegenerate?: () => void;
}

export function ReviewPanel({ review, loading, onRegenerate }: ReviewPanelProps) {
  if (loading && !review) {
    return (
      <div className="mt-6 p-6 rounded-md border border-parchment-600/40 bg-parchment-800/60 text-center">
        <div className="text-gold-light font-serif animate-pulse-soft">· 命运在称量你的选择 ·</div>
        <div className="text-xs text-parchment-200/60 mt-2">正在生成评分与总结…</div>
      </div>
    );
  }
  if (!review) return null;

  return (
    <div className="mt-8 animate-fade-in">
      <OrnateDivider>旅程结算</OrnateDivider>

      <div className="flex flex-col items-center mt-4 mb-6">
        <div className={clsx('w-24 h-24 rounded-full border-2 flex items-center justify-center text-4xl font-serif tracking-widest', GRADE_COLOR[review.grade])}>
          {review.grade}
        </div>
        <div className="mt-3 text-gold-light font-serif text-lg flex items-center gap-2">
          <Award size={18} /> 综合 {review.overall} / 100
        </div>
        <div className="mt-1 title-engraved font-serif text-2xl md:text-3xl">{review.title}</div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        {(Object.keys(review.scores) as Array<keyof AdventureReview['scores']>).map((k) => {
          const v = review.scores[k];
          return (
            <div key={k} className="bg-parchment-800/60 border border-parchment-600/40 rounded-md p-3">
              <div className="flex items-center justify-between text-sm font-serif">
                <span className="text-parchment-200/80">{DIM_LABEL[k]}</span>
                <span className="text-gold-light">{v}</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-parchment-900/70 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-gold-dark via-gold to-gold-light transition-all"
                  style={{ width: `${v}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {review.summary && (
        <div className="bg-parchment-800/60 border border-parchment-600/40 rounded-md p-5 mb-5">
          <h4 className="text-xs uppercase tracking-[0.3em] text-gold/70 mb-2 flex items-center gap-2">
            <Quote size={12} /> 旅程总结
          </h4>
          <p className="font-serif text-parchment-100 leading-loose whitespace-pre-line">{review.summary}</p>
        </div>
      )}

      {review.highlights.length > 0 && (
        <div className="bg-parchment-800/60 border border-parchment-600/40 rounded-md p-5 mb-5">
          <h4 className="text-xs uppercase tracking-[0.3em] text-gold/70 mb-3 flex items-center gap-2">
            <Sparkles size={12} /> 高光时刻
          </h4>
          <ul className="space-y-2">
            {review.highlights.map((h, i) => (
              <li key={i} className="flex gap-3 text-parchment-100 font-serif">
                <span className="text-gold-light">·</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.comment && (
        <div className="bg-parchment-800/60 border border-parchment-600/40 rounded-md p-5">
          <h4 className="text-xs uppercase tracking-[0.3em] text-gold/70 mb-2">点评</h4>
          <p className="font-serif text-parchment-100 leading-relaxed italic">{review.comment}</p>
        </div>
      )}

      <ThinkToggle content={review.thinking} />

      {onRegenerate && (
        <div className="text-center mt-6">
          <button
            onClick={onRegenerate}
            className="text-xs text-parchment-200/60 hover:text-gold-light underline underline-offset-4"
          >
            重新生成评分
          </button>
        </div>
      )}
    </div>
  );
}
