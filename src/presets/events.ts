import type { RandomEvent } from '@/types/content';

export const PRESET_EVENTS: RandomEvent[] = [
  {
    id: 'ev_mysterious_merchant',
    name: '神秘商人',
    directive:
      '引入一位来历不明的商人出现在玩家附近，试图兜售一件看似与玩家处境微妙相关的物品（但不点破其用途）。',
    probability: 0.12,
    minRound: 3,
    cooldown: 20,
  },
  {
    id: 'ev_old_friend',
    name: '故人重逢',
    directive:
      '让一个与玩家过去有纠葛的 NPC（旧友、旧敌或旧情）意外出现。这个人物的身份应与玩家"出身"自然契合。',
    probability: 0.1,
    minRound: 5,
    cooldown: 25,
    once: true,
  },
  {
    id: 'ev_prophetic_dream',
    name: '预兆之梦',
    directive:
      '在下一个入睡或短暂失神的时刻，让玩家做一段模糊却意味深长的梦，梦中的意象应当暗示主线后续的某个关键抉择。',
    probability: 0.1,
    minRound: 6,
    cooldown: 15,
  },
  {
    id: 'ev_thugs_ambush',
    name: '路霸伏击',
    directive:
      '在路途中让玩家遭遇一小队持械路霸/劫匪的伏击。数量应合理且可交涉或逃跑，而非一定要战斗。',
    probability: 0.1,
    minRound: 2,
    cooldown: 10,
  },
  {
    id: 'ev_lost_scroll',
    name: '遗失卷轴',
    directive:
      '让玩家在周围环境中发现一件不完整的文件/卷轴/便签，其内容与主线或世界书中的某条设定相关，但信息残缺。',
    probability: 0.09,
    minRound: 4,
    cooldown: 18,
  },
  {
    id: 'ev_stranger_ask_help',
    name: '陌生人求助',
    directive:
      '让一个陌生人突然向玩家求助，求助可以是具体而危险的，也可以是模棱两可的。玩家可以拒绝、观察、或介入。',
    probability: 0.1,
    minRound: 3,
    cooldown: 12,
  },
  {
    id: 'ev_strange_weather',
    name: '异变天象',
    directive:
      '出现一段不属于当地季节或时刻的天象（血月、双日、无云骤雨、反向的风等），氛围化地暗示世界正在偏离常轨。',
    probability: 0.08,
    minRound: 4,
    cooldown: 22,
  },
  {
    id: 'ev_forgotten_shrine',
    name: '遗忘的神龛',
    directive:
      '玩家在前进途中偶然看见一处被遗忘的神龛/墓碑/祭坛，上面的名字或图腾与当前世界书中的设定有模糊呼应。',
    probability: 0.08,
    minRound: 5,
    cooldown: 20,
  },
  {
    id: 'ev_pursuit',
    name: '有人在跟踪你',
    directive:
      '从本回合开始，让玩家隐约察觉有人在暗中跟踪，但跟踪者此回合不现身。此后若玩家未处理，跟踪者会在数回合后再次出现。',
    probability: 0.07,
    minRound: 7,
    cooldown: 30,
    once: true,
  },
  {
    id: 'ev_moral_witness',
    name: '不义之事',
    directive:
      '让玩家目击一桩非正义事件（欺凌、不公审判、虐待动物等）。事件的规模和干预代价应与玩家当前能力匹配。',
    probability: 0.09,
    minRound: 3,
    cooldown: 15,
  },
];
