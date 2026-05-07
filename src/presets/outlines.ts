import type { StoryOutline } from '@/types/content';

export const PRESET_OUTLINES: StoryOutline[] = [
  {
    id: 'outline_misplaced_youth',
    title: '错位青春',
    coverEmoji: '🌸',
    synopsis:
      '现代大学，一个半社恐宅男在女厕的尴尬危机里意外觉醒"性别错位"异能：可以把任意对象的性别+身份信息+外貌完整翻转，且他人的认知不会改变。从此他游走在曦宇与曦雨两套社会关系之间，从被表白会脸红到能从容拒绝，从澡堂出鼻血到坦然面对身体——直到高中时拯救过他的初恋夕晴重新回到他身边。',
    acts: [
      '第一幕 觉醒：女厕隔间内的危机让能力被迫显形，主角脱险并初步试探女生身份的边界。',
      '第二幕 成长：双身份并行运行，女生那一套社交从零搭起；主角从慌乱、好奇、被动应付，成长为能高情商斡旋两边的"另一个自己"。',
      '第三幕 重逢：高中初恋夕晴转入同校，主角以女生身份接近，最终在表白被拒+舍友揭穿+身份相认的连环反转中坦白能力，与对方走向互帮互助的恋爱日常。',
    ],
    tone: '校园日常 / 轻松治愈 / 主角成长 · 校园日常 ≥75%、恋爱 <25%；纯现实社会，仅主角拥有异能；不要转向悬疑/惊悚/玄幻',
    worldBookIds: ['wb_misplaced_youth'],
  },
];

export function getOutlineById(id: string | undefined): StoryOutline | undefined {
  if (!id) return undefined;
  return PRESET_OUTLINES.find((o) => o.id === id);
}
