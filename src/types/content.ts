// 可导入/导出的内容资源类型：世界书、大纲、出身、随机事件

import type { WorkspaceDocumentKind } from './workspace';

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

export interface RandomEvent {
  id: string;
  name: string;
  directive: string;          // 注入到故事 prompt 的指令
  probability: number;        // 0..1
  minRound?: number;
  cooldown?: number;          // 冷却轮数
  once?: boolean;             // 只触发一次
  tags?: string[];
}

export interface WorkspaceTemplateDocument {
  path: string;
  title?: string;
  kind?: WorkspaceDocumentKind;
  summary?: string;
  tags?: string[];
  content: string;
  archived?: boolean;
  stale?: boolean;
}

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description?: string;
  // 可选匹配条件：启程页会据此标记“推荐”，玩家仍可手动勾选/取消。
  outlineIds?: string[];
  backgroundIds?: string[];
  worldBookIds?: string[];
  tags?: string[];
  docs: WorkspaceTemplateDocument[];
}

// 导入包：用户一次性粘贴多种资源
export interface ImportBundle {
  worldBooks?: WorldBook[];
  outlines?: StoryOutline[];
  backgrounds?: Background[];
  events?: RandomEvent[];
  workspaceTemplates?: WorkspaceTemplate[];
}
