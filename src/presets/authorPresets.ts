import type { JourneyMode } from '@/types/game';

// 一键启程预设：把启程页前两步（选大纲 / 选出身）已经替你勾好的"故事包"。
// 想新增预设：在 AUTHOR_PRESETS 数组里 push 一个对象即可，PresetsPage 会自动渲染。

export type AuthorPresetStep = 'outline' | 'background' | 'config' | 'strict';

export interface AuthorPreset {
  id: string;
  title: string;
  coverEmoji?: string;
  /** 卡片副标题：题材 / 基调 / 占比等一句话定位 */
  subtitle?: string;
  /** 卡片正文：3~6 行说明这个预设里都准备了什么、适合什么玩家 */
  description: string;
  /** 题材标签，仅展示用 */
  tags?: string[];
  /** 简明三幕亮点；为空则不渲染 */
  acts?: string[];
  /** 启程页接收的预选参数 */
  preset: {
    outlineId: string;
    backgroundId: string;
    worldBookIds: string[];
    workspaceTemplateIds?: string[];
    characterName?: string;
    journeyMode?: JourneyMode;
    step?: AuthorPresetStep;
  };
}

export const AUTHOR_PRESETS: AuthorPreset[] = [
  {
    id: 'preset_misplaced_youth',
    title: '错位青春',
    coverEmoji: '🌸',
    subtitle: '现代大学 · 校园日常 ≥75% · 恋爱 <25% · 仅主角拥有"性别错位"异能',
    description:
      '半社恐宅男曦宇在女厕的尴尬危机中觉醒能力，可以把任意对象的性别+身份信息+外貌完整翻转，他人认知不变。从此他维持「曦宇 / 曦雨」两套并行社交关系，从慌乱、好奇、被动应付，成长为能从容斡旋两边的另一个自己——直到高中时拯救过他的初恋夕晴重新出现。',
    tags: ['校园', '日常', '主角成长', '轻恋爱'],
    acts: [
      '第一幕 觉醒：女厕隔间内的危机让能力被迫显形，主角脱险并初步试探女生身份。',
      '第二幕 成长：双身份并行运行，女生那一面的社交从零搭起；从被表白脸红到能高情商拒绝。',
      '第三幕 重逢：夕晴转入同校；表白被拒+舍友揭穿+身份相认的连环反转后坦白能力，走向恋爱日常。',
    ],
    preset: {
      outlineId: 'outline_misplaced_youth',
      backgroundId: 'bg_freshman_xiyu',
      worldBookIds: ['wb_misplaced_youth'],
      workspaceTemplateIds: ['wst_misplaced_youth'],
      characterName: '曦宇',
      journeyMode: 'author',
      step: 'config',
    },
  },
];

export function getAuthorPresetById(id: string | undefined): AuthorPreset | undefined {
  if (!id) return undefined;
  return AUTHOR_PRESETS.find((item) => item.id === id);
}
