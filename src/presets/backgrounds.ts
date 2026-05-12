import type { Background } from '@/types/content';

export const PRESET_BACKGROUNDS: Background[] = [
  {
    id: 'bg_freshman_xiyu',
    name: '大一新生 · 曦宇',
    coverEmoji: '🎒',
    description:
      '男，大一新生，半个社恐宅男，长相一般，是班里的"查无此人"。喜欢计算机、女装、看百合作品；几乎不被女生喜欢，也极少牵过女生的手。他还不知道，今天他的大学生活会因为一次内急而被劈成两半。',
    traits: ['半社恐', '宅', '心思细腻', '观察型', '低存在感'],
    startItems: ['学生证', '旧手机', '宿舍门禁卡', '一只半旧的双肩包'],
    startScene:
      '大一上学期，本该是普通的一天。\n\n曦宇刚才在教学楼三楼一路狂奔——那杯不该续杯的冰美式终于在撑不住的瞬间逼曦宇冲进最近一道厕所门，当时好像根本没顾得上看门牌。现在，隔间里曦宇正试图让自己人间蒸发，墙上的瓷砖凉得发亮。\n\n走廊里又传来轻快的脚步声和说话声——又来了几个女生。声音越来越近，停在曦宇这间隔间的门外排队半天的女生和她们聊了起来。\n\n「……这间怎么有人呆了这么久？」「敲门问问？」\n\n此时的曦宇连呼吸都不敢用力。曦宇低头看了看自己的运动裤——男生的板鞋——废话，男生进女厕毫无疑问，只要被发现，完全就是一个进女厕的变态，怎么也洗不清。\n\n外面的脚步有一人逐渐远去，剩下两人还在外面等待——自己的装死终归是没用，女生们怀疑厕所没人却锁上了，想要叫保洁来检查厕所。「应该是厕所门锁坏了，我记得刚刚看到保洁，我现在就去找她...」——坏了，这下坏了',
  },
];

export function getBackgroundById(id: string | undefined): Background | undefined {
  if (!id) return undefined;
  return PRESET_BACKGROUNDS.find((b) => b.id === id);
}
