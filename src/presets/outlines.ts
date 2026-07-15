import type { StoryOutline } from '@/types/content';

export const PRESET_OUTLINES: StoryOutline[] = [
  {
    id: 'outline_misplaced_youth',
    title: '错位青春',
    coverEmoji: '🌸',
    synopsis:
      '现代大学，一个半社恐宅男在女厕的尴尬危机里意外觉醒"性别错位"异能：可以把任意对象的性别+身份信息+外貌完整翻转，且他人的认知不会改变。从此他游走在曦宇与曦雨两套社会关系之间，从被表白会脸红到能从容拒绝，从澡堂出鼻血到坦然面对身体——直到高中时拯救过他的初恋夕晴重新回到他身边。',
    acts: [
      {
        id: 'act-awakening',
        title: '第一幕 · 觉醒',
        purpose: '让曦宇在现实校园危机中获得错位能力，理解能力边界，并主动踏出经营双身份生活的第一步。',
        beats: [
          { id: 'beat-toilet-crisis', title: '女厕危机', purpose: '走错女厕、女生叫来保洁开锁，现实危机迫使能力觉醒。' },
          { id: 'beat-first-shift', title: '首次错位', purpose: '曦宇首次成为曦雨并脱离危机，同时确认旁人记忆不会随身份信息改变。' },
          { id: 'beat-boundary-check', title: '验证边界', purpose: '通过证件、系统、宿舍与身体体验，理解能力实际改变与不改变的范围。' },
          { id: 'beat-safe-return', title: '恢复日常', purpose: '恢复为曦宇并回到原本生活，确认能力可逆且双身份均由同一意识掌控。' },
          { id: 'beat-dual-life-choice', title: '选择双身份生活', purpose: '主角从被动脱险转为主动探索曦雨身份，为长期成长作出真实选择。' },
        ],
      },
      {
        id: 'act-growth',
        title: '第二幕 · 成长',
        purpose: '让两套校园关系从分离走向交叉，使主角由慌乱应付成长为能坦然管理双身份与他人感情的人。',
        beats: [
          { id: 'beat-original-life', title: '维持原本生活', purpose: '曦宇继续经营学业、男寝与原有关系，双身份不能抹掉原本人生。' },
          { id: 'beat-new-connection', title: '从零建立关系', purpose: '曦雨以没有女性旧经历的新身份，建立第一段真实的新关系。' },
          { id: 'beat-parallel-circles', title: '两套关系并行', purpose: '两种身份各自形成可持续的日常、责任与情感联系。' },
          { id: 'beat-crossover-pressure', title: '关系开始交叉', purpose: '两边人物或事务产生交集，迫使主角面对身份无法永远完全隔离的问题。' },
          { id: 'beat-active-balance', title: '主动驾驭身份', purpose: '主角不再只靠躲避解决问题，能够坦然处理身体、关注、表白和两边关系。' },
        ],
      },
      {
        id: 'act-reunion',
        title: '第三幕 · 重逢',
        purpose: '让夕晴重新进入主角生活，在误解、揭穿与坦白后完成彼此相认，抵达互相帮助的恋爱日常。',
        beats: [
          { id: 'beat-xiqing-return', title: '夕晴归来', purpose: '夕晴通过符合当前路径的方式重新进入主角生活，唤回高中时期未完成的感情。' },
          { id: 'beat-approach-as-xiyu', title: '以曦雨接近', purpose: '主角以曦雨身份重新认识夕晴，在隐瞒真实身份的情况下建立新的亲近。' },
          { id: 'beat-confession-rejected', title: '表白与误解', purpose: '感情推进到表白被拒，迫使主角正视夕晴真正等待的人与自己的隐瞒。' },
          { id: 'beat-identity-exposed', title: '身份揭穿', purpose: '双身份秘密被舍友或等价事件揭开，使关系无法再停留在误解中。' },
          { id: 'beat-truth-shared', title: '相认与坦白', purpose: '曦宇与夕晴确认彼此身份，主角主动坦白错位能力及一路经历。' },
          { id: 'beat-shared-future', title: '互助恋爱日常', purpose: '双方接纳真实的彼此，并在校园日常中形成互相帮助、共同守护秘密的恋爱关系。' },
        ],
      },
    ],
    tone: '校园日常 / 轻松治愈 / 主角成长 · 校园日常 ≥75%、恋爱 <25%；纯现实社会，仅主角拥有异能；不要转向悬疑/惊悚/玄幻',
    worldBookIds: ['wb_misplaced_youth'],
  },
];

export function getOutlineById(id: string | undefined): StoryOutline | undefined {
  if (!id) return undefined;
  return PRESET_OUTLINES.find((o) => o.id === id);
}
