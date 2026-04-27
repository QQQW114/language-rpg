import type { Background } from '@/types/content';

export const PRESET_BACKGROUNDS: Background[] = [
  {
    id: 'bg_exiled_noble',
    name: '流亡贵族',
    coverEmoji: '⚜️',
    description:
      '你曾是北境赫尔凡家族的第三继承人。火焚的那夜，你从密道逃出城堡，只带走了家徽、一柄祖传短刃，以及对那些背叛者的仇恨。',
    traits: ['剑术初阶', '外交辞令', '记名识人'],
    startItems: ['家徽吊坠', '祖传短刃', '半袋银币'],
    startScene:
      '你在一条陌生的乡道上醒来。晨雾尚未散尽，衣袍沾满荆棘与血。远方山脊之上，北境的黑烟仍在燃烧。身上沉甸甸的家徽告诉你：那个叫作赫尔凡的名字，从此只剩下你一个人承担。',
  },
  {
    id: 'bg_apprentice_mage',
    name: '学徒法师',
    coverEmoji: '🔮',
    description:
      '你在白塔做了七年杂役与学徒，刚刚掌握最基础的咒文。导师在一场意外中失踪，留给你一本封缄的日记与一句模糊的遗言。',
    traits: ['初阶咒术', '古文识读', '谨慎多疑'],
    startItems: ['桦木法杖', '导师日记', '三枚符咒纸'],
    startScene:
      '白塔地下室的烛火被风吹得摇曳。导师的座椅空着，只余一本皮面日记压在案上。封皮上他的字迹仓促：「若我三日未归，带此物离开塔城，不要回头。」第三日已至。',
  },
  {
    id: 'bg_rogue',
    name: '夜行盗贼',
    coverEmoji: '🗝️',
    description:
      '你在贫民窟长大，十二岁加入盗贼公会，十八岁有了"夜影"的外号。你偷过王宫的香料，也偷过教堂的圣餐杯——如今却被公会以"私吞赃物"为由发出悬赏。',
    traits: ['潜行', '撬锁', '谎言识破'],
    startItems: ['撬锁工具', '黑色面巾', '毒针一枚'],
    startScene:
      '你躲在码头一艘破船的甲板下，海浪一下一下撞击船身。公会的悬赏告示就钉在不远处的木桩上，赫然画着你的侧脸。天快亮了，你得在下一班潮水之前做出选择。',
  },
  {
    id: 'bg_mercenary',
    name: '佣兵',
    coverEmoji: '🛡️',
    description:
      '十年间你站过十七个旗帜，为金币、为义气、也为活下去。左脸那道从眉骨到下颌的疤是某个秋天换来的——那场仗你至今不愿提起。',
    traits: ['近战格斗', '战场直觉', '粗野'],
    startItems: ['铁剑', '皮甲', '一壶烈酒'],
    startScene:
      '酒馆的壁炉烧得正旺，你刚结了上一单的账。一个斗篷遮脸的女人在你对面坐下，推过一袋金币：「有一份活，只有你能接。」她的口音不在本地。你的手，不由自主按向剑柄。',
  },
  {
    id: 'bg_cleric',
    name: '巡回神职者',
    coverEmoji: '📿',
    description:
      '你奉月神教团之命游走于乡野，为穷苦人治病、主持婚丧。但在某个雨夜，你亲眼看到了不该存在的事物，从此开始怀疑教团的教义。',
    traits: ['初阶治疗', '信仰祷词', '心理疏导'],
    startItems: ['月神圣徽', '药草包', '羊皮祈祷书'],
    startScene:
      '你在一座无名的小村庄里度过了第三个夜晚。灯油将尽，你跪在祭坛前却无法完整念出今夜的祷词。窗外远远传来孩子的哭喊——那不是人间的声音。',
  },
  {
    id: 'bg_scholar',
    name: '游学学者',
    coverEmoji: '📜',
    description:
      '你毕生致力于破译一门失传的古语。没有王权、没有神祇、没有亲人——只有一箱满是批注的书稿和一副度数过深的眼镜。',
    traits: ['博学', '观察入微', '不擅战斗'],
    startItems: ['古语词典', '放大镜', '笔记本'],
    startScene:
      '你在一座港口城市的藏书阁里熬了第四个通宵。窗外的晨雾散开时，一位头戴宽檐帽的陌生人推门而入，手里握着一卷你只在传说中见过的羊皮。他说："我需要你。"',
  },
];

export function getBackgroundById(id: string | undefined): Background | undefined {
  if (!id) return undefined;
  return PRESET_BACKGROUNDS.find((b) => b.id === id);
}
