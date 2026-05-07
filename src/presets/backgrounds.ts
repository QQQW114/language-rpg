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
      '大一上学期，普通的一天。\n\n曦宇刚才在教学楼三楼一路狂奔——那杯不该续杯的冰美式终于在撑不住的瞬间逼曦宇冲进最近一道厕所门，根本没顾得上看门牌。隔间里曦宇正畅快地解决问题，墙上的瓷砖凉得发亮。\n\n然后走廊里传来轻快的脚步声和说话声——是几个女生的声音。声音越来越近，停在了曦宇这间隔间的门外。\n\n一个女声压低了下来：「这间锁着……不会是有人占着不出来吧？」「等会儿再问问？」\n\n曦宇僵在原地，连呼吸都不敢用力。曦宇低头看了看自己的运动裤——男生的板鞋——男生的、毫无疑问是男生的一切。然后抬头看了眼隔间门牌：粉色，画着一个穿裙子的小人。\n\n曦宇走错厕所了。\n\n外面的脚步又近了一步，那个声音已经在叫保洁阿姨。一种灭顶的、社死级的恐惧从脚底窜上头皮——这是曦宇这辈子第一次想要某种神迹，任何神迹，来救救自己。',
  },
];

export function getBackgroundById(id: string | undefined): Background | undefined {
  if (!id) return undefined;
  return PRESET_BACKGROUNDS.find((b) => b.id === id);
}
