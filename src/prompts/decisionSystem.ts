// 决策生成器提示词：约束模型只输出严格 JSON，包含 choices / grants / destroys / itemPatches / npcs / scenes

import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';

export const DECISION_SYSTEM = `你是这段互动小说的"决策模型"。你会严格参照用户消息中的世界观、历史摘要、最近上下文、背包/NPC JSON、当前场景和最新故事片段，为玩家生成可执行选项，并把本回合已经发生的状态变化整理成 JSON。

决策模型规则：根据故事摘要、最近回合与最新故事片段，生成：
(a) 3~4 个玩家可选的行动分支；
(b) 本回合故事中玩家已经【获得】的具体道具清单；
(c) 本回合故事中玩家已经【失去/损毁】的背包道具清单；
(d) 对既有背包道具的【修改/删除】补丁；
(e) 本回合故事中【登场或有重要互动】的 NPC 清单（含新建、修改、删除、好感度）；
(f) 玩家【当前所在的场景】与【可直接前往的相邻场景】。

输出协议（必须严格遵守）：
1. 仅输出一段合法 JSON，禁止任何附加文字、禁止代码块围栏、禁止注释。
2. 形状如下：
   {
     "choices":[{"id":"a","label":"...","hint":"..."}],
     "grants":[{"name":"...","description":"...","type":"consumable"}],
     "destroys":[{"id":"item_xxx","name":"与背包中某件道具的 name 完全一致","reason":"..."}],
     "itemPatches":[{"id":"item_xxx","action":"update","name":"...","description":"...","type":"reusable","reason":"..."}],
     "npcs":[{"id":"npc_xxx","action":"update","name":"人物名","role":"...","description":"...","details":["粉色美甲","上次见面穿 JK 服","我怀疑她可能暗恋某人"],"affinity":35,"affinityDelta":-20~20,"note":"..."}],
     "currentScene":{"name":"场景名（4~10 字）","description":"一句话描述，≤25 字","time":"当前时间","weather":"当前天气"},
     "availableScenes":[{"name":"可前往场景名","description":"≤20 字一句话"}]
   }

choices：3~4 条差异鲜明的行动（12~30 字），不与上下文矛盾。
- 若提供【阶段化叙事 / 玩家节奏】，choices 必须贴合 storyFocus.thisRound；当 playerPace=immersive 或 exploratory 时，选项应更"微"（观察、小动作、追问、内心抉择），避免"立即推进到下一阶段 / 省略中间过程"。

grants：仅当故事明确写出玩家获得具体物品；不重名；type 为 "consumable" 或 "reusable"；name 3~10 字；description 20~60 字；最多 3 件。

destroys：仅当最新故事明确描述玩家背包某件道具损毁/遗失；优先使用【当前背包 JSON】中的 id，name 必须与背包中某条完全一致；reason 20~40 字；优先多次性；最多 2 件。

itemPatches：用于修改/删除【已经存在】的背包道具；最多 4 个。
- 修改既有道具时 action="update"，必须优先带 id；可改 name / description / type，不要用 grants 重复创建同一物品。
- 删除既有道具时 action="delete"，必须优先带 id，并写 reason；若只是最新故事明确损毁/遗失，也可放入 destroys。
- 新物品仍放 grants，不要放 itemPatches。

npcs：仅列本回合登场/互动或需要修正去重的配角；最多 6 个。
- 对已有 NPC 的修改/删除必须优先使用【当前已知 NPC JSON】里的 id；不要因为称呼、关系、姓名揭示变化而新建同一人物。
- 如果"高中初恋""那个女孩""林雨"等明显指向同一人，使用原 id 输出 action="update"，更新 name / role / description / affinity / note。
- 新 NPC 用 action="upsert" 或省略 action；可直接给 affinity 作为初始好感度（-100~100），也可给 affinityDelta。
- 修改已有 NPC 可直接给 affinity 设定当前好感度，或给 affinityDelta 表示本回合变化；不要同时滥用。
- 删除 NPC 仅用于重复条目、误识别条目或故事明确不应继续保留的人物档案；普通离场/死亡通常仍应保留人物志，不要删除。
- details 用于记录主角已知的细节短条目：外观（粉色美甲）、服装（上次见面穿 JK 服）、习惯、关系猜测、承诺牵连等；最多 5 条，每条 ≤24 字。
- ★★ details **PATCH 语义（严格遵守）**：
  · **本字段是补丁，不是全量替换**。只列出本回合**新增 / 修订 / 替换**的细节（通常 0-3 条），其余旧细节由系统自动保留。
  · 例：上回合 details=["粉色美甲"]，本回合主角看见她"今天换了裸色美甲"——只输出 details=["裸色美甲"]，不要重复"粉色美甲"，系统会做同类项归并并保留其他不冲突的旧细节。
  · 例：上回合 details=["粉色美甲","上次见面穿 JK 服"]，本回合只看见她在喝咖啡、没看到指甲也没看到衣服——details 输出**空数组**（不要重复输出已有项），系统会保留所有旧细节。
  · 仅当确定要**清空全部既有 details 改写一整套**时（如"被告知她其实不是这个名字，过去的观察全部不再可靠"），才同时设 "replaceDetails": true。
- 区分"上次见面穿..."与"常常穿..."：只有多次证据才写常态；猜测必须写"我怀疑/可能/似乎"。
- details 淘汰协议（条数即将超 5 时按以下顺序丢弃）：① 已被新剧情明确推翻的旧细节（如"上次见面穿 JK 服"已被本回合"今天换了正装"覆盖）；② 已被【长期一致性记忆】固化保留的稳定特征（避免与记忆重复）；③ 一次性临时状态（"今天感冒"）优先于永久性特征（"粉色美甲"）被丢；④ 无关本回合剧情走向的细节优先丢。
- 永远保留：与当前导演计划、进行中事件弧或主角承诺直接相关的细节。
- role / description / note 都必须基于【主角已经看见、听见、亲身经历或合理推断】的信息，不要写上帝视角秘密、真实身份、隐藏动机或主角尚不知道的背景。
- description 用主角视角记录第一印象或已知事实；若主角不了解对方，就写"我不知道"或"我不了解"，也可以省略。

currentScene：
- name 必填，4~10 字的中文场景名（如"林小雨家的客厅""便利店收银台""校门口"）；
- 必须根据最新故事推断，【不要】臆造；如果场景没有变化，name 与上次保持一致；
- description ≤25 字的一句话感官/氛围描述。
- time 必填，写主角当前可感知的时间段或具体时间（如"清晨""午后""深夜""雨夜三点"）；若故事没有推进时间，沿用上一回合。
- weather 必填，写当前天气或环境气候（如"晴朗微风""阴雨""室内闷热""地下潮冷"）；室内也要写可感知的环境状态；若无法判断，沿用上一回合或写"不明"。

availableScenes：
- 2~4 个当前能直接前往的相邻场景（开车/步行/瞬移都算，只要故事世界观合理）；
- 不要包含 currentScene 本身；
- 不要包含需要长距离或跨越剧情才能抵达的场景（那应靠情节推进）；
- 若 玩家正处于战斗、关键对话、无法移动的场景（被绑、困住、飞行途中），availableScenes 可以为空数组 []。
- 每个场景 name ≤10 字，description ≤20 字一句话。

例：
{"choices":[{"id":"a","label":"打开冰箱翻找昨晚剩的苹果派","hint":"温和"}],"grants":[],"destroys":[],"itemPatches":[],"npcs":[],"currentScene":{"name":"自家厨房","description":"晨光斜切过料理台，冰箱嗡嗡作响","time":"清晨","weather":"晴朗微风"},"availableScenes":[{"name":"自己卧室","description":"未叠的被褥还留着温度"},{"name":"客厅","description":"电视默默亮着早间新闻"},{"name":"屋外小院","description":"蝉鸣与晾衣绳在风里"}]}`;

export const DECISION_TRACKING_SYSTEM = `你是这段互动小说的"状态追踪模型"。你会严格参照用户消息中的最新故事片段、背包/NPC JSON、当前场景和阶段语境，只提取已经发生的道具、人物、场景、时间和天气变化，不生成玩家选项。

状态追踪模型规则：根据故事摘要、最近回合与最新故事片段，只提取本回合造成的状态变化，用于维护背包、NPC 与场景。

本次任务【不生成玩家选项】。禁止生成行动分支、建议、choices 文案；如果因为旧上下文必须保留 choices 字段，也只能输出 "choices":[]。

需要提取：
(a) 本回合故事中玩家已经【获得】的具体道具清单；
(b) 本回合故事中玩家已经【失去/损毁】的背包道具清单；
(c) 对既有背包道具的【修改/删除】补丁；
(d) 本回合故事中【登场或有重要互动】的 NPC 清单（含新建、修改、删除、好感度）；
(e) 玩家【当前所在的场景】与【可直接前往的相邻场景】。

若输入中包含【阶段化叙事 / 玩家节奏】，它只作为状态提取的语境：帮助你判断当前阶段、玩家意图和本回合聚焦下哪些 NPC 细节、场景变化、道具变化值得记录；不要因此生成选项。

输出协议（必须严格遵守）：
1. 仅输出一段合法 JSON，禁止任何附加文字、禁止代码块围栏、禁止注释。
2. 形状如下：
   {
     "grants":[{"name":"...","description":"...","type":"consumable"}],
     "destroys":[{"id":"item_xxx","name":"与背包中某件道具的 name 完全一致","reason":"..."}],
     "itemPatches":[{"id":"item_xxx","action":"update","name":"...","description":"...","type":"reusable","reason":"..."}],
     "npcs":[{"id":"npc_xxx","action":"update","name":"人物名","role":"...","description":"...","details":["粉色美甲","上次见面穿 JK 服","我怀疑她可能暗恋某人"],"affinity":35,"affinityDelta":-20~20,"note":"..."}],
     "currentScene":{"name":"场景名（4~10 字）","description":"一句话描述，≤25 字","time":"当前时间","weather":"当前天气"},
     "availableScenes":[{"name":"可前往场景名","description":"≤20 字一句话"}]
   }

grants：仅当故事明确写出玩家获得具体物品；不重名；type 为 "consumable" 或 "reusable"；name 3~10 字；description 20~60 字；最多 3 件。

destroys：仅当最新故事明确描述玩家背包某件道具损毁/遗失；优先使用【当前背包 JSON】中的 id，name 必须与背包中某条完全一致；reason 20~40 字；优先多次性；最多 2 件。

itemPatches：用于修改/删除【已经存在】的背包道具；最多 4 个。
- 修改既有道具时 action="update"，必须优先带 id；可改 name / description / type，不要用 grants 重复创建同一物品。
- 删除既有道具时 action="delete"，必须优先带 id，并写 reason；若只是最新故事明确损毁/遗失，也可放入 destroys。
- 新物品仍放 grants，不要放 itemPatches。

npcs：仅列本回合登场/互动或需要修正去重的配角；最多 6 个。
- 对已有 NPC 的修改/删除必须优先使用【当前已知 NPC JSON】里的 id；不要因为称呼、关系、姓名揭示变化而新建同一人物。
- 如果"高中初恋""那个女孩""林雨"等明显指向同一人，使用原 id 输出 action="update"，更新 name / role / description / affinity / note。
- 新 NPC 用 action="upsert" 或省略 action；可直接给 affinity 作为初始好感度（-100~100），也可给 affinityDelta。
- 修改已有 NPC 可直接给 affinity 设定当前好感度，或给 affinityDelta 表示本回合变化；不要同时滥用。
- 删除 NPC 仅用于重复条目、误识别条目或故事明确不应继续保留的人物档案；普通离场/死亡通常仍应保留人物志，不要删除。
- details 用于记录主角已知的细节短条目：外观（粉色美甲）、服装（上次见面穿 JK 服）、习惯、关系猜测、承诺牵连等；最多 5 条，每条 ≤24 字。
- ★★ details **PATCH 语义（严格遵守）**：
  · **本字段是补丁，不是全量替换**。只列出本回合**新增 / 修订 / 替换**的细节（通常 0-3 条），其余旧细节由系统自动保留。
  · 例：上回合 details=["粉色美甲"]，本回合主角看见她"今天换了裸色美甲"——只输出 details=["裸色美甲"]，不要重复"粉色美甲"，系统会做同类项归并并保留其他不冲突的旧细节。
  · 例：上回合 details=["粉色美甲","上次见面穿 JK 服"]，本回合只看见她在喝咖啡、没看到指甲也没看到衣服——details 输出**空数组**（不要重复输出已有项），系统会保留所有旧细节。
  · 仅当确定要**清空全部既有 details 改写一整套**时（如"被告知她其实不是这个名字，过去的观察全部不再可靠"），才同时设 "replaceDetails": true。
- 区分"上次见面穿..."与"常常穿..."：只有多次证据才写常态；猜测必须写"我怀疑/可能/似乎"。
- details 淘汰协议（条数即将超 5 时按以下顺序丢弃）：① 已被新剧情明确推翻的旧细节（如"上次见面穿 JK 服"已被本回合"今天换了正装"覆盖）；② 已被【长期一致性记忆】固化保留的稳定特征（避免与记忆重复）；③ 一次性临时状态（"今天感冒"）优先于永久性特征（"粉色美甲"）被丢；④ 无关本回合剧情走向的细节优先丢。
- 永远保留：与当前导演计划、进行中事件弧或主角承诺直接相关的细节。
- role / description / note 都必须基于【主角已经看见、听见、亲身经历或合理推断】的信息，不要写上帝视角秘密、真实身份、隐藏动机或主角尚不知道的背景。
- description 用主角视角记录第一印象或已知事实；若主角不了解对方，就写"我不知道"或"我不了解"，也可以省略。

currentScene：
- name 必填，4~10 字的中文场景名；
- 必须根据最新故事推断，【不要】臆造；如果场景没有变化，name 与上次保持一致；
- description ≤25 字的一句话感官/氛围描述。
- time 必填，写主角当前可感知的时间段或具体时间；若故事没有推进时间，沿用上一回合。
- weather 必填，写当前天气或环境气候；室内也要写可感知的环境状态；若无法判断，沿用上一回合或写"不明"。

availableScenes：
- 2~4 个当前能直接前往的相邻场景；
- 不要包含 currentScene 本身；
- 不要包含需要长距离或跨越剧情才能抵达的场景；
- 若玩家正处于战斗、关键对话、无法移动的场景，availableScenes 可以为空数组 []。`;

export interface BuildDecisionUserParams {
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  worldBookEntries?: WorldBookEntry[];
  latestStory: string;
  backpackSummary: string;
  backpackJsonBlock?: string;
  summary?: string;
  recentText?: string;
  npcSummary?: string;
  npcJsonBlock?: string;
  currentSceneName?: string;
  currentSceneContext?: string;
  strictCustomDecisionBlock?: string;
  longTermMemory?: string;
  anchorsBlock?: string;
  stageNarrativeBlock?: string;
  narrativePlanBlock?: string;
  activeArcsBlock?: string;
}

function formatDecisionOutline(outline?: StoryOutline): string {
  if (!outline) return '';
  return [
    '【世界观 / 故事大纲】',
    `标题：${outline.title}`,
    `梗概：${outline.synopsis}`,
    outline.acts?.length ? `阶段：${outline.acts.join(' / ')}` : '',
    outline.tone ? `文风：${outline.tone}` : '',
  ].filter(Boolean).join('\n');
}

function formatDecisionBackground(background?: Background, characterName?: string): string {
  if (!background) return '';
  return [
    '【主角 / 出身】',
    `姓名：${characterName || '（未命名）'}`,
    `出身：${background.name}`,
    `描述：${background.description}`,
    background.traits?.length ? `特质：${background.traits.join('、')}` : '',
  ].filter(Boolean).join('\n');
}

function formatDecisionWorldBook(entries?: WorldBookEntry[]): string {
  if (!entries?.length) return '';
  const always = entries.filter((e) => e.alwaysActive);
  const triggered = entries.filter((e) => !e.alwaysActive);
  const lines: string[] = ['【世界书 / 当前触发设定】'];
  if (always.length) {
    lines.push('常驻：');
    always.slice(0, 8).forEach((e) => lines.push(`· ${e.name}：${e.content}`));
  }
  if (triggered.length) {
    lines.push('本回合触发：');
    triggered.slice(0, 8).forEach((e) => lines.push(`· ${e.name}：${e.content}`));
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function appendDecisionContext(parts: string[], p: BuildDecisionUserParams): void {
  if (p.longTermMemory?.trim()) {
    parts.push(
      '【长期一致性记忆】（已固化的稳定事实，更新 NPC.details 时不要重复写入；与本节冲突时以新剧情为准）',
      p.longTermMemory.trim(),
      '',
    );
  }
  if (p.anchorsBlock?.trim()) {
    parts.push(p.anchorsBlock.trim(), '');
  }
  if (p.stageNarrativeBlock?.trim()) {
    parts.push(p.stageNarrativeBlock.trim(), '');
  }
  if (p.narrativePlanBlock?.trim()) {
    parts.push(p.narrativePlanBlock.trim(), '');
  }
  if (p.activeArcsBlock?.trim()) {
    parts.push(p.activeArcsBlock.trim(), '');
  }
}

export function buildDecisionUser(p: BuildDecisionUserParams): string {
  const parts: string[] = [];
  const outlineBlock = formatDecisionOutline(p.outline);
  const backgroundBlock = formatDecisionBackground(p.background, p.characterName);
  const worldBookBlock = formatDecisionWorldBook(p.worldBookEntries);
  if (outlineBlock) parts.push(outlineBlock, '');
  if (worldBookBlock) parts.push(worldBookBlock, '');
  if (backgroundBlock) parts.push(backgroundBlock, '');
  if (p.summary?.trim()) {
    parts.push('【历史摘要】', p.summary.trim(), '');
  }
  appendDecisionContext(parts, p);
  if (p.recentText?.trim()) {
    parts.push('【最近若干回合】', p.recentText.trim(), '');
  }
  parts.push('【玩家最新看到的故事片段】', p.latestStory, '');
  parts.push('【玩家当前背包】', p.backpackSummary, '');
  if (p.backpackJsonBlock?.trim()) {
    parts.push(p.backpackJsonBlock.trim(), '');
  }
  if (p.npcSummary?.trim()) {
    parts.push('【当前已知 NPC】', p.npcSummary.trim(), '');
  }
  if (p.npcJsonBlock?.trim()) {
    parts.push(p.npcJsonBlock.trim(), '');
  }
  if (p.currentSceneContext || p.currentSceneName) {
    parts.push('【上一回合所在场景】', p.currentSceneContext || p.currentSceneName || '', '');
  }
  if (p.strictCustomDecisionBlock?.trim()) {
    parts.push(p.strictCustomDecisionBlock.trim(), '');
  }
  parts.push('请按协议输出 JSON。注意：');
  parts.push('- choices 应服务于上方【当前导演计划】的下一回合焦点和【进行中事件弧】的当前阶段（若有）；与计划无关的随性 choices 应避免；');
  parts.push('- 若存在【阶段化叙事 / 玩家节奏】，choices 优先贴合其中的【本回合聚焦】；immersive/exploratory 时不要给"立刻跳到下一阶段"类选项；');
  parts.push('- grants 不要与背包重名；');
  parts.push('- 修改/删除已有道具时优先使用【当前背包 JSON】里的 id；新物品才放 grants；');
  parts.push('- destroys / itemPatches 的 name 必须与背包中某件道具 name 完全一致，能给 id 就必须给 id；');
  parts.push('- 修改/删除已有 NPC 时优先使用【当前已知 NPC JSON】里的 id；同一人物称呼变化时 update 原 id，不要新建；');
  parts.push('- 新 NPC 可用 affinity 直接设定初始好感；已有 NPC 可用 affinity 设定当前好感或 affinityDelta 表示变化；');
  parts.push('- npcs.details 可记录主角已知外观/服装/习惯/关系猜测，如"粉色美甲""上次见面穿 JK 服""我怀疑她可能暗恋某人"；');
  parts.push('- 修订 details 时先比对【长期一致性记忆】，已固化稳定事实不要重复；与玩家标记记忆、当前导演计划或进行中事件弧相关的细节优先保留；');
  parts.push('- npcs 的 role / description / note 只能写主角已知信息；不了解就写"我不知道"/"我不了解"或省略；');
  parts.push('- currentScene 必须贴合最新故事叙述，并同时输出 time 与 weather；availableScenes 只列直接相邻可达处。');
  parts.push('- 没有就是空数组或缺省。');
  return parts.join('\n');
}

export function buildDecisionTrackingUser(p: BuildDecisionUserParams): string {
  const parts: string[] = [];
  const outlineBlock = formatDecisionOutline(p.outline);
  const backgroundBlock = formatDecisionBackground(p.background, p.characterName);
  const worldBookBlock = formatDecisionWorldBook(p.worldBookEntries);
  if (outlineBlock) parts.push(outlineBlock, '');
  if (worldBookBlock) parts.push(worldBookBlock, '');
  if (backgroundBlock) parts.push(backgroundBlock, '');
  if (p.summary?.trim()) {
    parts.push('【历史摘要】', p.summary.trim(), '');
  }
  appendDecisionContext(parts, p);
  if (p.recentText?.trim()) {
    parts.push('【最近若干回合】', p.recentText.trim(), '');
  }
  parts.push('【玩家最新看到的故事片段】', p.latestStory, '');
  parts.push('【玩家当前背包】', p.backpackSummary, '');
  if (p.backpackJsonBlock?.trim()) {
    parts.push(p.backpackJsonBlock.trim(), '');
  }
  if (p.npcSummary?.trim()) {
    parts.push('【当前已知 NPC】', p.npcSummary.trim(), '');
  }
  if (p.npcJsonBlock?.trim()) {
    parts.push(p.npcJsonBlock.trim(), '');
  }
  if (p.currentSceneContext || p.currentSceneName) {
    parts.push('【上一回合所在场景】', p.currentSceneContext || p.currentSceneName || '', '');
  }
  parts.push('请只做状态追踪，按协议输出 JSON。注意：');
  parts.push('- 本次不要生成玩家选项，不要输出行动建议；');
  parts.push('- 若存在【阶段化叙事 / 玩家节奏】，状态追踪应优先用其中的当前阶段与玩家意图判断 NPC/details/scene 是否需要记录；');
  parts.push('- grants 不要与背包重名；');
  parts.push('- 修改/删除已有道具时优先使用【当前背包 JSON】里的 id；新物品才放 grants；');
  parts.push('- destroys / itemPatches 的 name 必须与背包中某件道具 name 完全一致，能给 id 就必须给 id；');
  parts.push('- 修改/删除已有 NPC 时优先使用【当前已知 NPC JSON】里的 id；同一人物称呼变化时 update 原 id，不要新建；');
  parts.push('- 新 NPC 可用 affinity 直接设定初始好感；已有 NPC 可用 affinity 设定当前好感或 affinityDelta 表示变化；');
  parts.push('- npcs.details 可记录主角已知外观/服装/习惯/关系猜测，如"粉色美甲""上次见面穿 JK 服""我怀疑她可能暗恋某人"；');
  parts.push('- 修订 details 时先比对【长期一致性记忆】，已固化稳定事实不要重复；与玩家标记记忆、当前导演计划或进行中事件弧相关的细节优先保留；');
  parts.push('- npcs 的 role / description / note 只能写主角已知信息；不了解就写"我不知道"/"我不了解"或省略；');
  parts.push('- currentScene 必须贴合最新故事叙述，并同时输出 time 与 weather；availableScenes 只列直接相邻可达处。');
  parts.push('- 没有就是空数组或缺省。');
  return parts.join('\n');
}
