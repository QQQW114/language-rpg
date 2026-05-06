// Review Agent：在旅程结束后请求一份评分 JSON

import type { AppSettings } from '@/types/settings';
import type { AdventureReview, GameSave } from '@/types/game';
import type { StoryOutline, Background } from '@/types/content';
import { chatJSONDetailed } from './llmClient';
import { REVIEW_SYSTEM, buildReviewUser } from '@/prompts/reviewSystem';
import { extractJSON, clamp, nowMs } from '@/lib/utils';

export interface ReviewRequest {
  settings: AppSettings;
  save: GameSave;
  outline?: StoryOutline;
  background?: Background;
  signal?: AbortSignal;
}

function clampGrade(s: unknown): AdventureReview['grade'] {
  const v = String(s ?? '').toUpperCase();
  if (v === 'S' || v === 'A' || v === 'B' || v === 'C' || v === 'D') return v;
  return 'B';
}

function gradeFromOverall(overall: number): AdventureReview['grade'] {
  if (overall >= 90) return 'S';
  if (overall >= 80) return 'A';
  if (overall >= 70) return 'B';
  if (overall >= 60) return 'C';
  return 'D';
}

function sanitize(obj: any): AdventureReview | null {
  if (!obj || typeof obj !== 'object') return null;
  const scoresRaw = obj.scores ?? {};
  const scores = {
    narrative: clamp(Math.round(Number(scoresRaw.narrative ?? 0) || 0), 0, 100),
    choices: clamp(Math.round(Number(scoresRaw.choices ?? 0) || 0), 0, 100),
    immersion: clamp(Math.round(Number(scoresRaw.immersion ?? 0) || 0), 0, 100),
    completion: clamp(Math.round(Number(scoresRaw.completion ?? 0) || 0), 0, 100),
  };
  const avg = Math.round((scores.narrative + scores.choices + scores.immersion + scores.completion) / 4);
  const overallNum = Number(obj.overall);
  const overall = Number.isFinite(overallNum) ? clamp(Math.round(overallNum), 0, 100) : avg;
  const grade = obj.grade ? clampGrade(obj.grade) : gradeFromOverall(overall);
  const title = String(obj.title ?? '').trim().slice(0, 40) || '未题旅程';
  const summary = String(obj.summary ?? '').trim().slice(0, 800);
  const comment = String(obj.comment ?? '').trim().slice(0, 500);
  const highlights = Array.isArray(obj.highlights)
    ? obj.highlights
        .map((h: unknown) => String(h ?? '').trim())
        .filter(Boolean)
        .slice(0, 6)
        .map((s: string) => s.slice(0, 50))
    : [];
  if (!summary && !comment && highlights.length === 0) return null;
  return {
    title,
    summary,
    scores,
    overall,
    grade,
    highlights,
    comment,
    generatedAt: nowMs(),
  };
}

const RECENT_MESSAGES = 8;

export async function requestReview(p: ReviewRequest): Promise<AdventureReview> {
  const { settings, save, outline, background, signal } = p;
  const recent = save.state.history.slice(-RECENT_MESSAGES);

  const userPrompt = buildReviewUser({
    outline,
    background,
    characterName: save.content.characterName,
    summary: save.state.summary,
    recent,
    ending: save.state.ending,
    totalRounds: save.config.totalRounds,
  });

  const model = settings.summaryModel?.trim() || settings.storyModel;

  const run = async (temperature: number): Promise<AdventureReview | null> => {
    const result = await chatJSONDetailed(
      { baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey, format: settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: REVIEW_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        signal,
      },
    );
    const review = sanitize(extractJSON(result.text));
    return review ? { ...review, thinking: result.thinking, rawOutput: result.text, usage: result.usage } : null;
  };

  try {
    const r1 = await run(0.4);
    if (r1) return r1;
  } catch (err) {
    console.warn('[reviewAgent] first attempt failed', err);
  }
  try {
    const r2 = await run(0.2);
    if (r2) return r2;
  } catch (err) {
    console.warn('[reviewAgent] retry failed', err);
  }

  // 最终兜底
  return {
    title: '旅程结束',
    summary: '由于评估服务暂未返回有效内容，本次旅程的细节可到故事回顾中自行翻阅。',
    scores: { narrative: 0, choices: 0, immersion: 0, completion: 0 },
    overall: 0,
    grade: 'D',
    highlights: [],
    comment: '评分未生成。',
    generatedAt: nowMs(),
  };
}
