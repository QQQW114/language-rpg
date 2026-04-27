// 随机生成 · 提示词

import type { StoryOutline, Background, WorldBookEntry } from '@/types/content';

// ---------- 随机故事大纲 ----------

export const RANDOM_OUTLINE_SYSTEM = `你是一位题材全能的 TRPG 故事总设计师（高奇幻 / 低魔 / 赛博朋克 / 哥特悬疑 / 架空历史 / 末世科幻 等皆可驾驭）。你需要为玩家原创一段供一次性游玩的故事大纲。

输出协议（严格 JSON，无围栏，无多余文字）：
{
  "title": "4~10 个汉字，鲜明有辨识度",
  "synopsis": "100~220 字的剧情梗概，交代主角定位、核心冲突、世界氛围、关键悬念",
  "acts": ["第一幕：...","第二幕：...","第三幕：..."],
  "tone": "一句话（10~25 字）的文风与题材描述",
  "coverEmoji": "一个 emoji 作为封面符号"
}

硬性要求：
- 题材、主角处境、世界观每次尽量不同，避免模板化。
- 三幕结构有明显递进，第三幕需指向一个具有代价与抉择的收束点。
- 不要使用现实中的主流 IP 名称、人名、地名（如魔戒/哈利波特/星战等）。
- 中文输出，不要出现英文句子。`;

export interface RandomOutlineHints {
  theme?: string;            // 用户可选的主题提示（如"赛博朋克"），可空
  avoidTitles?: string[];    // 已存在的标题，生成时尽量避开
}

export function buildRandomOutlineUser(hints: RandomOutlineHints = {}): string {
  const lines: string[] = ['请设计一段全新的故事大纲。'];
  if (hints.theme?.trim()) {
    lines.push(`主题偏好：${hints.theme.trim()}`);
  } else {
    lines.push('随意选择一个题材，但要有冲击力与新鲜感。');
  }
  if (hints.avoidTitles?.length) {
    lines.push(`请避开以下已有标题：${hints.avoidTitles.join('、')}`);
  }
  lines.push('按协议输出 JSON。');
  return lines.join('\n');
}

// ---------- 随机出身 ----------

export const RANDOM_BACKGROUND_SYSTEM = `你是 TRPG 角色创作师。请为给定的故事大纲生成一个契合的玩家"出身"。

输出协议（严格 JSON，无围栏，无多余文字）：
{
  "name": "4~6 字的出身名",
  "description": "60~140 字的出身与处境描述",
  "traits": ["技能/特点 1","技能/特点 2","技能/特点 3"],
  "startItems": ["物品 1","物品 2","物品 3"],
  "startScene": "180~300 字的开局场景",
  "coverEmoji": "一个 emoji"
}

要求：
- 出身应贴合故事大纲的世界观与冲突，但不要直接剧透主线。
- traits 3~4 条；startItems 2~4 件（若包含药水、卷轴、符咒、食物、饮料等一次性物品，请直接用这些词，便于系统识别为"一次性"）。
- startScene 使用第二人称"你"，具象感官细节开场，结尾留一个微小悬念但不要直接问玩家要做什么。
- 中文输出。`;

export function buildRandomBackgroundUser(outline: StoryOutline, worldSummary?: string, hint?: string): string {
  const parts: string[] = [];
  parts.push('【故事大纲】');
  parts.push(`《${outline.title}》`);
  parts.push(outline.synopsis);
  if (outline.tone) parts.push(`文风：${outline.tone}`);
  if (worldSummary) parts.push('', '【世界设定（可选参考）】', worldSummary);
  if (hint?.trim()) parts.push('', `【玩家希望的出身偏好】${hint.trim()}`);
  parts.push('', '请生成一个符合上述背景的玩家出身，按协议输出 JSON。');
  return parts.join('\n');
}

// ---------- 随机开局 ----------

export const RANDOM_SCENE_SYSTEM = `你是互动小说的开篇作者。根据给定的故事大纲与玩家出身，重新撰写一段开篇场景。

要求：
- 使用第二人称"你"
- 200~360 字
- 具象感官细节开场，避免俗套（切忌"他醒来"、"阳光洒进"之类开头）
- 结尾留一个微小的悬念或未知，但不要直接提出"你要做什么"之类的元指令
- 直接输出场景正文，禁止输出标题、引号、注释
- 中文`;

export function buildRandomSceneUser(outline: StoryOutline, background: Background, hint?: string): string {
  const parts: string[] = [];
  parts.push('【故事大纲】');
  parts.push(`《${outline.title}》`);
  parts.push(outline.synopsis);
  parts.push('', '【玩家出身】');
  parts.push(`${background.name} —— ${background.description}`);
  parts.push(`携带：${background.startItems.join('、') || '无'}`);
  if (hint?.trim()) parts.push('', `【玩家希望的开局偏好】${hint.trim()}`);
  parts.push('', '请撰写一段开篇场景。');
  return parts.join('\n');
}

// ---- 随机事件池 ----

export const RANDOM_EVENTS_SYSTEM = `你是 TRPG 随机事件设计师。根据给定的故事大纲与玩家出身（可能还有开局场景与主题提示），设计 5~8 条贴合该世界观、该主角处境、该题材基调的随机事件。这些事件会在游戏中按概率触发，作为指令注入给故事模型，让故事在合适时机"自然融入"事件。

输出协议（严格 JSON，无围栏，无多余文字）：
{
  "events": [
    {
      "name": "事件名（4~10 字）",
      "directive": "给故事模型的指令（60~140 字），以'请在本回合自然地让...'或类似语气开头，明确描述让故事在合适契机下发生什么；不要直接写出结果与玩家反应",
      "probability": 0.05~0.18 之间的数字（越常见越高）,
      "minRound": 1~10 的整数（最早可触发的回合）,
      "cooldown": 10~25 的整数（触发后的冷却回合）,
      "once": true 或 false
    }
  ]
}

设计要求：
- 事件必须【与题材契合】：恋爱/校园故事不要出现"怪物袭击"；奇幻冒险不要出现"考试临近"；赛博朋克不要出现"古籍现身"。
- 覆盖不同类型：至少包含一条"情感/社交""偶遇/NPC""环境/氛围""意外/小挫折""机会/线索"等差异化事件。
- directive 要具体但留出施展空间；不要规定玩家的选择与反应（那是玩家和模型的事）。
- 一些"关键性"事件（如告白、重要 NPC 登场）应设为 once: true 且 minRound 稍晚。
- 名称要有画面感，避免"事件 1""小插曲"这种泛泛之词。
- 严禁让事件推翻大纲主线方向。`;

export interface BuildRandomEventsUserParams {
  outline: StoryOutline;
  background?: Background;
  startScene?: string;
  hint?: string;
  count?: number;
}

export function buildRandomEventsUser(p: BuildRandomEventsUserParams): string {
  const parts: string[] = [];
  parts.push('【故事大纲】');
  parts.push(`《${p.outline.title}》`);
  parts.push(p.outline.synopsis);
  if (p.outline.tone) parts.push(`文风/题材：${p.outline.tone}`);
  if (p.background) {
    parts.push('', '【玩家出身】', `${p.background.name} —— ${p.background.description}`);
  }
  if (p.startScene) {
    parts.push('', '【开局场景】', p.startScene);
  }
  if (p.hint?.trim()) {
    parts.push('', `【玩家希望的事件偏好】${p.hint.trim()}`);
  }
  parts.push('', `请设计 ${p.count ?? 6} 条契合上述设定的随机事件，按协议输出 JSON。`);
  return parts.join('\n');
}

// 把世界书条目简要合成供随机出身参考
export function summarizeWorldEntries(entries: WorldBookEntry[]): string {
  if (!entries?.length) return '';
  return entries.slice(0, 6).map((e) => `· ${e.name}：${e.content}`).join('\n');
}

// ---- 随机世界书 ----

export const RANDOM_WORLDBOOK_SYSTEM = `你是经验丰富的 TRPG 世界观设计师。为玩家生成一份可用于游戏的"世界书"——一组互补的设定条目，由一条"常驻"条目给出世界基调，其余条目以关键词触发的方式补充具体细节（组织、地点、魔法体系、势力、风俗等）。

输出协议（严格 JSON，无围栏，无多余文字）：
{
  "name": "6~14 字中文世界书名",
  "description": "20~50 字一句话总览",
  "entries": [
    {
      "name": "条目标题（4~10 字）",
      "keywords": ["命中即触发的关键词 1","关键词 2"],
      "content": "条目正文（60~160 字），补充具体设定细节，便于故事模型引用",
      "priority": 0~100 的整数（数值越大越优先，常驻条目常给 80~100）,
      "alwaysActive": true 或 false
    }
  ]
}

设计要求：
- 首条目必须是 "alwaysActive": true 的"世界基调"，keywords 为空数组 []，给出总体氛围/时代/科技魔法水平等。
- 其余条目为 alwaysActive: false，关键词触发，覆盖不同侧面：重要组织/地点/种族/风俗/魔法或科技体系/历史事件等至少 4~5 种面向，共 5~8 条。
- 条目之间要互补，不要彼此重复。
- 关键词要有代表性（NPC 常用称呼、地名、组织名等）；每条 1~4 个关键词。
- 若有提供故事大纲，条目应与其契合但不要剧透其具体情节。
- 中文输出。`;

export interface BuildRandomWorldBookUserParams {
  outline?: StoryOutline;
  hint?: string;
  count?: number;
}

export function buildRandomWorldBookUser(p: BuildRandomWorldBookUserParams = {}): string {
  const parts: string[] = [];
  if (p.outline) {
    parts.push('【故事大纲（可供参考）】');
    parts.push(`《${p.outline.title}》`);
    parts.push(p.outline.synopsis);
    if (p.outline.tone) parts.push(`文风/题材：${p.outline.tone}`);
  }
  if (p.hint?.trim()) {
    parts.push('', `【玩家希望的世界书偏好】${p.hint.trim()}`);
  }
  parts.push('', `请设计 ${p.count ?? 7} 条（含 1 条常驻基调）条目，按协议输出 JSON。`);
  return parts.join('\n');
}
