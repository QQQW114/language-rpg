import { AlertTriangle, BookPlus, Check, ChevronDown, ShieldCheck, X } from 'lucide-react';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useGameStore } from '@/store/useGameStore';
import type { AuthorNarrativeState, SettingPatch } from '@/types/game';

function PatchItem({ patch }: { patch: SettingPatch }) {
  const must = patch.severity === 'must';
  return (
    <div
      className={`rounded border px-3 py-2 text-xs leading-relaxed ${
        must
          ? 'border-blood/50 bg-blood/10 text-parchment-50'
          : 'border-parchment-600/35 bg-parchment-900/30 text-parchment-200/75'
      }`}
    >
      <div className={must ? 'font-serif text-blood/90' : 'font-serif text-gold-light'}>
        {patch.topic}
      </div>
      <div className="mt-1">{patch.advice}</div>
    </div>
  );
}

export function SettingGuardPanel({
  saveId,
  narrative,
}: {
  saveId: string;
  narrative?: AuthorNarrativeState;
}) {
  const guard = narrative?.settingGuard;
  const patches = guard?.patches ?? [];
  const must = patches.filter((p) => p.severity === 'must');
  const should = patches.filter((p) => p.severity === 'should');
  const candidates = (guard?.candidates ?? []).filter((c) => c.status === 'pending');
  const beats = (guard?.pendingAmbientBeats ?? []).filter((b) => !b.consumed);
  const preference = guard?.preference?.confidence !== 'low' ? guard?.preference : undefined;
  const hasAny = !!guard && (
    patches.length > 0
    || candidates.length > 0
    || beats.length > 0
    || !!preference
    || !!guard.deviation
    || !!guard.lastError
  );

  const actions = useGameStore.getState();

  return (
    <Card>
      <CardTitle className="flex items-center gap-2 text-base">
        <ShieldCheck size={16} /> 设定守护者
      </CardTitle>
      <CardMeta>故事生成前的世界书护栏、设定补丁与玩家偏好画像。</CardMeta>

      {!hasAny && (
        <div className="text-xs text-parchment-200/60 leading-relaxed">
          暂无守护者输出。启用后会在每次故事生成前检查世界书、记忆与玩家输入。
        </div>
      )}

      {guard?.lastError && (
        <div className="mb-2 rounded border border-blood/50 bg-blood/10 px-3 py-2 text-xs leading-relaxed text-blood/90">
          守护者记录：{guard.lastError}
        </div>
      )}

      {guard?.deviation && (
        <div className="mb-2 rounded border border-blood/60 bg-blood/10 px-3 py-2 text-xs leading-relaxed text-parchment-100">
          <div className="mb-1 flex items-center justify-between gap-2 text-blood/90">
            <span className="flex items-center gap-1 font-serif">
              <AlertTriangle size={13} /> 偏离风险
            </span>
            <button
              type="button"
              onClick={() => actions.clearSettingGuardDeviation(saveId)}
              className="text-[11px] text-parchment-200/55 hover:text-parchment-100"
            >
              清除
            </button>
          </div>
          <div>{guard.deviation.description}</div>
          {!!guard.deviation.affectedEntryNames?.length && (
            <div className="mt-1 text-parchment-200/60">
              涉及：{guard.deviation.affectedEntryNames.join('、')}
            </div>
          )}
        </div>
      )}

      {(must.length > 0 || should.length > 0) && (
        <div className="mb-2 space-y-2">
          {must.map((patch) => <PatchItem key={patch.id} patch={patch} />)}
          {should.map((patch) => <PatchItem key={patch.id} patch={patch} />)}
        </div>
      )}

      {candidates.length > 0 && (
        <details className="group mb-2 rounded border border-gold/30 bg-gold/10 px-3 py-2" open>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-gold-light">
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
            候选世界书 · {candidates.length}
          </summary>
          <div className="mt-2 space-y-2">
            {candidates.map((candidate) => (
              <div key={candidate.id} className="rounded border border-parchment-600/35 bg-parchment-900/35 px-3 py-2">
                <div className="text-sm font-serif text-parchment-50">{candidate.name}</div>
                {!!candidate.keywords.length && (
                  <div className="mt-0.5 text-[11px] text-gold/70">
                    {candidate.keywords.join('、')}
                  </div>
                )}
                <div className="mt-1 text-xs leading-relaxed text-parchment-200/75">{candidate.content}</div>
                <div className="mt-1 text-[11px] leading-relaxed text-parchment-200/50">{candidate.rationale}</div>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => actions.acceptSettingCandidate(saveId, candidate.id)}
                  >
                    <BookPlus size={12} /> 加入书库
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => actions.rejectSettingCandidate(saveId, candidate.id)}
                  >
                    <X size={12} /> 忽略
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {beats.length > 0 && (
        <details className="group mb-2 rounded border border-parchment-600/35 bg-parchment-900/30 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-gold-light">
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
            环境侧建议 · {beats.length}
          </summary>
          <div className="mt-2 space-y-2">
            {beats.map((beat) => (
              <div key={beat.id} className="text-xs leading-relaxed text-parchment-200/75">
                <div className="text-parchment-100">
                  {beat.optional ? '' : '【强烈建议】'}{beat.source} · {beat.trigger}
                </div>
                <div>{beat.beat}</div>
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-parchment-200/50 hover:text-gold-light"
                  onClick={() => actions.markAmbientBeatConsumed(saveId, beat.id)}
                >
                  <Check size={11} /> 标记已处理
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {preference?.tendency && (
        <details className="group rounded border border-parchment-600/35 bg-parchment-900/30 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-gold-light">
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
            玩家偏好 · {preference.confidence}
          </summary>
          <div className="mt-2 text-xs leading-relaxed text-parchment-200/75">
            <div>{preference.tendency}</div>
            {!!preference.recentSignals?.length && (
              <div className="mt-1 text-parchment-200/50">
                信号：{preference.recentSignals.join('；')}
              </div>
            )}
          </div>
        </details>
      )}
    </Card>
  );
}
