// 可导入/导出的内容资源类型：世界书、大纲、出身、随机事件

import type { StoryArc } from './game';

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

export interface StoryOutline {
  id: string;
  title: string;
  synopsis: string;           // 简介
  acts: string[];             // 三幕（或更多）节点
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
  arc?: StoryArc;             // 动态生成的长线事件弧（可作为书库素材保存）
}

// 导入包：用户一次性粘贴多种资源
export interface ImportBundle {
  worldBooks?: WorldBook[];
  outlines?: StoryOutline[];
  backgrounds?: Background[];
  events?: RandomEvent[];
}
