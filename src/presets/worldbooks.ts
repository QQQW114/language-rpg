import type { WorldBook } from '@/types/content';

export const PRESET_WORLDBOOKS: WorldBook[] = [
  {
    id: 'wb_dragon_realm',
    name: '龙裔启示录 · 世界书',
    description: '高奇幻世界的背景设定',
    entries: [
      {
        id: 'wbe_dr_world',
        name: '世界基调',
        keywords: [],
        alwaysActive: true,
        priority: 100,
        content:
          '这是名为"艾瑟兰"的大陆。千年前龙族与人类签订了"鳞约"，共同击退深渊生物。百年前鳞约破裂，龙族沉眠于北境冰原之下。王国林立，教会强盛，魔法稀有但被严格管控。神祇仍在但沉默。',
      },
      {
        id: 'wbe_dr_magic',
        name: '魔法',
        keywords: ['魔法', '咒文', '法术', '秘术'],
        priority: 20,
        content:
          '魔法需要古龙语发音与精神专注，施放会抽走使用者的体温。过度使用会让人渐渐变冷且遗忘童年的记忆。法师之塔只剩下三座。',
      },
      {
        id: 'wbe_dr_church',
        name: '教会',
        keywords: ['教会', '神父', '主教', '信仰', '月神'],
        priority: 15,
        content:
          '月神教团是大陆上最强的信仰组织，奉"沉默的月"为主神。教会内部分为"白袍"（公开的慈善与审判）与"灰袍"（秘密情报与异端调查）两派。',
      },
      {
        id: 'wbe_dr_dragon',
        name: '龙',
        keywords: ['龙', '古龙', '龙裔', '龙语'],
        priority: 30,
        content:
          '真正的古龙仅剩七条，皆沉眠于北境的龙冢之中。龙裔是极稀有的人类，血脉中带有古龙的印记，成长期会出现异象，被教会列为"需登记对象"。龙语是世界原初的语言之一。',
      },
      {
        id: 'wbe_dr_northlands',
        name: '北境',
        keywords: ['北境', '赫尔凡', '冰原', '寒风口'],
        priority: 10,
        content:
          '北境是严寒且半独立的领地，旧有七大家族。赫尔凡家族世代守卫寒风口，抵御来自冰原裂隙的深渊生物。百年前的一次"黑焰之夜"让北境元气大伤。',
      },
      {
        id: 'wbe_dr_merchants',
        name: '银月商会',
        keywords: ['商会', '银月', '商人', '行会'],
        priority: 8,
        content:
          '银月商会是大陆上最大的跨国行会，有自己的金匠、信使与雇佣兵。表面经营香料与织物，暗中亦贩售情报。',
      },
    ],
  },
  {
    id: 'wb_ravenholm',
    name: '夜雾中的拉文霍姆 · 世界书',
    description: '哥特悬疑世界的背景设定',
    entries: [
      {
        id: 'wbe_rh_world',
        name: '世界基调',
        keywords: [],
        alwaysActive: true,
        priority: 100,
        content:
          '时代大约是 19 世纪末，煤气灯、蒸汽机、黑胶唱片并存。此地远离主流文明，偶有游医、巡回剧团、记者造访。超自然事件存在但罕有亲历者愿意承认。',
      },
      {
        id: 'wbe_rh_town',
        name: '拉文霍姆镇',
        keywords: ['拉文霍姆', '小镇', '镇公所', '教堂'],
        alwaysActive: true,
        priority: 50,
        content:
          '拉文霍姆位于山谷深处，常年被夜雾笼罩。人口约 400，主业为伐木与铁矿。全镇只有一条主街，尽头是那座 40 年前被焚毁、未被重建的圣马可教堂。',
      },
      {
        id: 'wbe_rh_fire',
        name: '四十年前的大火',
        keywords: ['教堂', '大火', '焚毁', '十三', '圣马可'],
        priority: 30,
        content:
          '四十年前的冬至夜，圣马可教堂在弥撒途中起火，十三名信徒遇难。事件原因众说纷纭：油灯打翻、纵火、神罚。最奇特的是此后数年内，镇上居民对此事的记忆逐渐模糊——如今几乎无人能说出死者姓名。',
      },
      {
        id: 'wbe_rh_fog',
        name: '夜雾',
        keywords: ['夜雾', '白雾', '雾气'],
        priority: 25,
        content:
          '每晚日落后雾气从山谷底部升起。长期暴露在夜雾中的人会做同样的梦：一间烛火摇曳的教堂与十三张模糊的脸。极少数深度受影响者会整夜失踪、第二天出现在雾里回不过神。',
      },
      {
        id: 'wbe_rh_mayor',
        name: '镇长亚瑟·洛克伍德',
        keywords: ['镇长', '洛克伍德', '亚瑟'],
        priority: 15,
        content:
          '亚瑟·洛克伍德，62 岁，当年大火时他 22 岁。拉文霍姆的实际掌权者，面容和善，深得人心。书房上锁的抽屉里有一张当年的名单。',
      },
    ],
  },
];

export function getWorldBookById(id: string): { book: typeof PRESET_WORLDBOOKS[number]; } | undefined {
  const book = PRESET_WORLDBOOKS.find((b) => b.id === id);
  return book ? { book } : undefined;
}
