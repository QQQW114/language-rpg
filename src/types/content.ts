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

export interface StoryAct {
  id: string;
  title: string;
  purpose: string;
  beats: StoryBeat[];
}

export interface StoryOutline {
  id: string;
  title: string;
  synopsis: string;           // 简介
  acts: StoryAct[];           // 有顺序的命运阶段与必要故事节
  tone?: string;              // 文风提示
  worldBookIds?: string[];    // 默认挂载
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
