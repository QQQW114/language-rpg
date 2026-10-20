// 可导入/导出的内容资源类型：故事大纲、世界书、出身
//
// 随机事件不再有内容库：V2 由 engine.ts 在到期回合注入轻量随机事件指令，
// 由 patch.ts 负责调度，不依赖事件条目。

export interface WorldBookEntry {
  id: string;
  name: string;
  keywords: string[];      // 命中任一关键词则激活
  content: string;         // 注入到故事 prompt 的正文
  priority?: number;       // 多条命中时的排序（大者优先）
  alwaysActive?: boolean;  // 常驻注入
}

export interface WorldBook {
  id: string;
  name: string;
  description?: string;
  entries: WorldBookEntry[];
}

// 大纲只保存命运骨架：幕说明阶段方向，故事节说明必须经历的叙事功能。
// 具体地点、事件形式与承担角色由规划模型随玩家路径动态重构。
export interface StoryBeat {
  id: string;
  title: string;
  purpose: string;
}

/**
 * 幕级「阶段高级约束」字段的字数上限（按 Unicode 字符/码点计）。
 * 内容库校验、工坊保存归一化与编辑器 maxLength 共用同一份常量，避免三处漂移。
 */
export const STORY_ACT_ADVANCED_LIMITS = {
  /** 开幕引子：进入本幕时的舞台状态、气氛与核心议题转移。 */
  entryBrief: 200,
  /** 本幕写作契约/禁令：允许展开的范围与“禁止提前写穿”的底线。 */
  stageContract: 200,
  /** 幕完成标志：人类可读的阶段收束标志。 */
  exitCriteriaNote: 120,
} as const;

export type StoryActAdvancedField = keyof typeof STORY_ACT_ADVANCED_LIMITS;

export interface StoryAct {
  id: string;
  title: string;
  purpose: string;
  beats: StoryBeat[];
  // 以下为可选「阶段高级约束」，全部与幕状态机解耦：
  // 只影响内容层（提示词/工坊），旧内容缺省时行为完全不变。
  /** 开幕引子（≤200 字符）：进入本幕时的舞台状态、气氛与核心议题转移，不指定固定场景。 */
  entryBrief?: string;
  /** 本幕写作契约/禁令（≤200 字符）：本幕允许展开的范围与“禁止提前写穿”的底线，写边界而非固定路线。 */
  stageContract?: string;
  /** 幕完成标志（≤120 字符）：人类可读的阶段收束标志，不锁定具体事件。 */
  exitCriteriaNote?: string;
}

export interface StoryOutline {
  id: string;
  title: string;
  synopsis: string;           // 简介
  acts: StoryAct[];           // 有顺序的命运阶段与必要故事节
  tone?: string;              // 文风提示
  worldBookIds?: string[];    // 默认挂载
  /** 推荐出身：填写后启程页只展示这些出身（缺省=不限制，展示全部）。 */
  backgroundIds?: string[];
  coverEmoji?: string;        // 卡片上的装饰符号
}

export interface Background {
  id: string;
  name: string;
  description: string;
  traits: string[];
  startItems: string[];
  startScene: string;         // 开局文案
  coverEmoji?: string;
}

// 导入包：用户一次性粘贴多种资源
export interface ImportBundle {
  worldBooks?: WorldBook[];
  outlines?: StoryOutline[];
  backgrounds?: Background[];
}

/** 浏览器书库导出的稳定 JSON 包格式。 */
export interface ContentExportPackage {
  kind: 'language-rpg.content-library';
  version: 1;
  exportedAt: number;
  content: ImportBundle;
}

export type ContentResourceKind = 'outline' | 'background' | 'worldBook' | 'bundle';

export interface ContentValidationIssue {
  kind: ContentResourceKind;
  path: string;
  code: string;
  message: string;
}

export interface ContentValidationResult<T> {
  ok: boolean;
  value?: T;
  issues: ContentValidationIssue[];
}

export interface ContentMutationResult {
  ok: boolean;
  issues: ContentValidationIssue[];
}

export interface ContentImportResult {
  added: number;
  updated: number;
  skipped: number;
  issues: ContentValidationIssue[];
}
