import type { Background, StoryOutline, WorldBook } from '@/types/content';
import type { GameSave, Item, Npc, SceneRef, StoryArc } from '@/types/game';
import type { WorkspaceCreateInput } from '@/types/workspace';
import { createWorkspaceDocument, getWorkspaceDocumentByPath, getWorkspaceDocuments, patchWorkspaceDocument } from '@/storage/ledgerRepository';

export interface WorkspaceSeedResources {
  outline?: StoryOutline;
  background?: Background;
  worldBooks?: WorldBook[];
}

function safePathPart(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback)
    .replace(/[\\/:*?"<>|#%{}[\]^~`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48) || fallback;
}

function mdList(items: string[] | undefined): string {
  const list = (items ?? []).map((item) => item.trim()).filter(Boolean);
  return list.length ? list.map((item) => `- ${item}`).join('\n') : '- 暂无';
}

function sceneDoc(scene: SceneRef): string {
  return [
    `# ${scene.name}`,
    '',
    ...workspaceHeader({
      usage: '记录当前旅程中可被模型查阅的场景事实、时间天气和稳定细节。',
      trust: '以主角实际到达/观察到的内容为准；未亲眼确认的信息应标注为传闻或猜测。',
      update: '场景变化时追加“当前状态/历史状态”，避免把过去天气、摆设误写成永久状态。',
    }),
    '',
    `- 时间：${scene.time || '未记录'}`,
    `- 天气：${scene.weather || '未记录'}`,
    '',
    '## 描述',
    scene.description || '暂无描述。',
  ].join('\n');
}

function npcDoc(npc: Npc): string {
  return [
    `# ${npc.name}`,
    '',
    ...workspaceHeader({
      usage: '记录主角已知的人物身份、关系、外观、服装、习惯、好感与近期互动。',
      trust: '主角视角档案；不知道的真相写成“我不知道/我不确定”，不要上帝视角泄底。',
      update: '关系变化、外观/服装细节、承诺、误会和好感变化应及时合并；删除重复角色。',
    }),
    '',
    `- 身份 / 角色：${npc.role || '未记录'}`,
    `- 好感度：${npc.affinity}`,
    `- 初次出现：第 ${npc.firstRound} 回合`,
    `- 最近出现：第 ${npc.lastRound} 回合`,
    `- 出现次数：${npc.appearances}`,
    '',
    '## 主角已知描述',
    npc.description || '暂无描述。',
    '',
    '## 稳定细节',
    mdList(npc.details),
    '',
    '## 近期备注',
    npc.recentNote || '暂无。',
  ].join('\n');
}

function itemDoc(item: Item): string {
  const lifecycle = item.pendingDestroy
    ? 'pending_destroy'
    : item.pendingGrantKey
      ? 'pending_grant'
      : 'owned';
  return [
    `# ${item.name}`,
    '',
    ...workspaceHeader({
      usage: '记录单个能力的来源、当前状态、用途、限制和剧情影响。故事模型或决策模型需要核对能力时优先读取。',
      trust: '以正文和决策模型共同确认的能力状态为准；若与能力总表冲突，优先核对最近回合卷宗。',
      update: '获得、失效、遗忘、升级、改名或用途变化时更新；能力离开主角掌握后应标记生命周期而不是无痕删除。',
    }),
    '',
    `- 类型：${item.type}`,
    `- 生命周期：${lifecycle}`,
    `- 获得回合：第 ${item.acquiredAtRound} 回合`,
    item.pendingDestroy ? `- 待失效原因：${item.destroyReason || '未记录'}` : undefined,
    '',
    '## 当前状态',
    item.description || '暂无描述。',
    '',
    '## 原始数据',
    jsonBlock(item),
  ].filter((x) => x !== undefined).join('\n');
}

function eventDoc(arc: StoryArc): string {
  return [
    `# ${arc.title}`,
    '',
    ...workspaceHeader({
      usage: '记录单个事件弧的生命周期、目标、隐藏意图、完成/失败标准、阶段进度和写作边界。',
      trust: '由事件模型、导演模型与正文共同确认；hiddenIntent 只能供规划参考，不应直接泄露给主角视角。',
      update: '事件推进、转折、完成、失败、延后或改写时更新生命周期；完成后可归档但保留结果与影响。',
    }),
    '',
    `- 类型：${arc.type}`,
    `- 状态：${arc.status}`,
    `- 生命周期：${arc.lifecycle ?? arc.status}`,
    `- 起始回合：第 ${arc.startRound} 回合`,
    arc.targetEndRound !== undefined ? `- 目标结束回合：第 ${arc.targetEndRound} 回合` : undefined,
    arc.progressPercent !== undefined ? `- 进度：${arc.progressPercent}%` : undefined,
    arc.involvedNpcNames?.length ? `- 相关人物：${arc.involvedNpcNames.join('、')}` : undefined,
    '',
    '## 摘要',
    arc.summary || '暂无摘要。',
    '',
    '## 指令 / 写作边界',
    arc.directive || '暂无指令。',
    arc.writingBoundary ? `\n写作边界：${arc.writingBoundary}` : '',
    '',
    '## 表层目标',
    arc.surfaceGoal || '暂无。',
    '',
    '## 隐藏意图（仅供规划，不得直接泄露）',
    arc.hiddenIntent || '暂无。',
    '',
    '## 完成标准',
    mdList(arc.completionCriteria),
    '',
    '## 失败 / 放弃标准',
    mdList([...(arc.failureCriteria ?? []), ...(arc.abandonCriteria ?? [])]),
    '',
    '## 阶段',
    arc.stages?.length
      ? arc.stages.map((stage, index) => [
        `### ${index + 1}. ${stage.title}`,
        `- 回合范围：${stage.startRound}-${stage.endRound}`,
        `- 目标：${stage.goal}`,
        '',
        '必达节拍：',
        mdList(stage.requiredBeats),
        stage.avoid ? `\n避免：${stage.avoid}` : '',
      ].join('\n')).join('\n\n')
      : '暂无阶段。',
    '',
    '## 进度备注',
    arc.progressNote || '暂无。',
    '',
    '## 原始数据',
    jsonBlock(arc),
  ].filter((x) => x !== undefined).join('\n');
}

function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function workspaceHeader(params: {
  usage: string;
  trust?: string;
  update: string;
}): string[] {
  return [
    '> 司书库文件：本文件只属于当前旅程。模型可按需读取；不要把它当成所有故事共享的书库预设。',
    '',
    `- 用途：${params.usage}`,
    `- 当前可信度：${params.trust ?? '以玩家编辑、最新正文与模型最近写入为准；与正文冲突时先核对来源。'}`,
    `- 更新原则：${params.update}`,
  ];
}

export function buildWorkspaceSeedDocuments(save: GameSave, resources: WorkspaceSeedResources = {}): WorkspaceCreateInput[] {
  const state = save.state;
  const content = save.content;
  const round = state.currentRound ?? 0;
  const characterName = content.characterName?.trim() || '主角';
  const docs: WorkspaceCreateInput[] = [];

  docs.push({
    saveId: save.id,
    path: 'protagonist/profile.md',
    title: `${characterName} · 主角档案`,
    kind: 'protagonist',
    tags: ['主角', '角色'],
    updatedAtRound: round,
    updatedBy: 'seed',
    summary: '主角姓名、出身、基础设定与当前状态。',
    content: [
      `# ${characterName}`,
      '',
      ...workspaceHeader({
        usage: '记录主角档案、出身、已知能力与当前状态；故事模型写主角行动时优先参考。',
        update: '只记录当前旅程已经成立的信息；新增能力、身份变化、伤势、心理倾向时及时补充。',
      }),
      '',
      `- 旅程：${save.name}`,
      `- 模式：${content.mode === 'author' ? '执笔模式' : '游历模式'}`,
      `- 当前回合：${state.currentRound}`,
      '',
      '## 出身',
      resources.background
        ? [
          `### ${resources.background.name}`,
          resources.background.description,
          '',
          '#### 特质',
          mdList(resources.background.traits),
          '',
          '#### 初始能力',
          mdList(resources.background.startItems),
          '',
          '#### 开局文本',
          resources.background.startScene || '暂无。',
        ].join('\n')
        : '未记录。',
      '',
      '## 角色面板原始数据',
      Object.keys(state.characterSheet ?? {}).length ? jsonBlock(state.characterSheet) : '暂无。',
    ].join('\n'),
  });

  if (resources.outline) {
    docs.push({
      saveId: save.id,
      path: 'director/outline.md',
      title: '故事大纲',
      kind: 'director',
      tags: ['大纲', '主线'],
      updatedAtRound: round,
      updatedBy: 'seed',
      summary: resources.outline.synopsis,
      content: [
        `# ${resources.outline.title}`,
        '',
        ...workspaceHeader({
          usage: '完整故事大纲。回忆、补写跳过片段、判断主线方向和防止自由发挥时优先读取。',
          trust: '创建旅程时选定的大纲；除非玩家或导演明确改写，否则视为主线硬参照。',
          update: '大纲变更应保留旧方向与新方向的差异说明，避免直接抹掉已经发生的正文。',
        }),
        '',
        resources.outline.synopsis,
        '',
        '## 阶段 / 章节',
        mdList(resources.outline.acts),
        '',
        '## 风格',
        resources.outline.tone || '未记录。',
      ].join('\n'),
    });
  }

  if (resources.background?.startScene) {
    docs.push({
      saveId: save.id,
      path: 'director/opening.md',
      title: '开局文本 / 初始场景',
      kind: 'director',
      tags: ['开局', '初始场景', '回溯参考'],
      updatedAtRound: 0,
      updatedBy: 'seed',
      summary: '旅程创建时的开局文本；补写或回忆开场前后事件时优先参考。',
      content: [
        '# 开局文本 / 初始场景',
        '',
        ...workspaceHeader({
          usage: '旅程第 0 回合/开局文本。主角回忆开局、跳过开局、补写前情时必须优先参考。',
          trust: '开局事实来源；若后文没有改写，优先级高于模型临场发挥。',
          update: '不要重写原开局；若需要补充隐藏真相，应另起“后续补充”小节标明来源回合。',
        }),
        '',
        `出身：${resources.background.name}`,
        `主角：${characterName}`,
        '',
        resources.background.startScene,
      ].join('\n'),
    });
  }

  const customConfig = content.authorCustom?.enabled ? content.authorCustom : content.strictCustom;
  if (customConfig?.enabled) {
    docs.push({
      saveId: save.id,
      path: 'director/custom-rules.md',
      title: content.authorCustom?.enabled ? '执笔模式自定义规则' : '严格自定义规则',
      kind: 'rule',
      tags: ['严格自定义', '执笔模式', '规则'],
      updatedAtRound: round,
      updatedBy: 'seed',
      summary: '旅程创建时固化的自定义叙事规则与提示词覆盖状态。',
      content: [
        `# ${content.authorCustom?.enabled ? '执笔模式自定义规则' : '严格自定义规则'}`,
        '',
        ...workspaceHeader({
          usage: '玩家在启程时固化的叙事规则、节奏偏好和提示词覆盖状态。',
          trust: '玩家显式填写内容优先；空字段不构成约束。',
          update: '只在玩家修改或导入新旅程配置时改写；模型不得自行扩大为新硬规则。',
        }),
        '',
        `- 启用：${customConfig.enabled ? '是' : '否'}`,
        `- 提示词覆盖：${customConfig.promptOverrideEnabled ? '开启' : '关闭'}`,
        '',
        '## 全局叙事约束',
        customConfig.globalPrompt || '暂无。',
        '',
        '## 推进粒度',
        customConfig.pacingPrompt || '暂无。',
        '',
        '## 隐藏设定揭示规则',
        customConfig.revealPrompt || '暂无。',
        '',
        '## 决策 / 选项规则',
        customConfig.choicePrompt || '暂无。',
      ].join('\n'),
    });
  }

  if (content.storyStyle) {
    docs.push({
      saveId: save.id,
      path: 'rules/story-style.md',
      title: '故事风格设置',
      kind: 'rule',
      tags: ['故事风格', '设置'],
      updatedAtRound: round,
      updatedBy: 'seed',
      summary: '创建旅程时固化的故事长度与风格偏好。',
      content: [
        '# 故事风格设置',
        '',
        ...workspaceHeader({
          usage: '记录本旅程的故事长度、文风、偏好与玩家想读的叙事质感。',
          trust: '玩家设置项；不覆盖世界观硬设定和已经发生的剧情。',
          update: '玩家在设置中调整风格时同步；不要由模型自行扩写成复杂规则。',
        }),
        '',
        `- 故事长度：${content.storyStyle.storyLength}`,
        '',
        '## 风格偏好',
        content.storyStyle.storyStyleAddendum || '暂无。',
      ].join('\n'),
    });
  }

  const masterArc = state.authorNarrative?.masterArc;
  if (masterArc) {
    docs.push({
      saveId: save.id,
      path: 'director/master-arc.md',
      title: '主弧 / 阶段化目标',
      kind: 'director',
      tags: ['主弧', '阶段目标'],
      updatedAtRound: masterArc.updatedAtRound ?? round,
      updatedBy: 'seed',
      summary: masterArc.summary,
      content: [
        `# ${masterArc.title}`,
        '',
        ...workspaceHeader({
          usage: '执笔模式主弧与阶段目标。判断当前故事在哪个阶段、是否偏离大纲时读取。',
          trust: '由主弧模型生成并随阶段推进更新；低于正文事实，高于临场发挥。',
          update: '阶段进入/完成时更新状态；不要把未达成的预期节拍写成已经发生。',
        }),
        '',
        masterArc.summary,
        '',
        `- 当前阶段序号：${masterArc.currentStageIndex + 1}`,
        `- 生成回合：${masterArc.generatedAtRound}`,
        `- 更新回合：${masterArc.updatedAtRound}`,
        '',
        '## 阶段',
        ...masterArc.stages.map((stage, index) => [
          `### ${index + 1}. ${stage.name}（${stage.status}）`,
          stage.description,
          '',
          '进入条件：',
          mdList(stage.enterConditions),
          '',
          '完成条件：',
          mdList(stage.completionConditions),
          '',
          '预期节拍：',
          mdList(stage.expectedBeats.map((beat) => `${beat.status} · ${beat.description}`)),
        ].join('\n')),
      ].join('\n'),
    });
  }

  const directorPlan = state.authorNarrative?.plan;
  if (directorPlan) {
    docs.push({
      saveId: save.id,
      path: 'director/current-plan.md',
      title: '当前叙事导演计划',
      kind: 'director',
      tags: ['叙事导演', '近期计划'],
      updatedAtRound: directorPlan.updatedAtRound ?? round,
      updatedBy: 'seed',
      summary: directorPlan.nextRoundFocus || directorPlan.stageGoal || '当前导演计划。',
      content: [
        '# 当前叙事导演计划',
        '',
        ...workspaceHeader({
          usage: '近期叙事方向和未来数回合计划。故事写手需要用它保持短期目标和节奏。',
          trust: '导演最近一次规划；若玩家行动导致偏离，应让司辰/导演重算，而不是硬推旧计划。',
          update: '导演刷新后覆盖本文件；旧计划可归档，不应与当前计划并列混用。',
        }),
        '',
        directorPlan.currentAct ? `- 当前幕：${directorPlan.currentAct}` : undefined,
        directorPlan.currentStage ? `- 当前阶段：${directorPlan.currentStage}` : undefined,
        directorPlan.stageGoal ? `- 阶段目标：${directorPlan.stageGoal}` : undefined,
        directorPlan.nextRoundFocus ? `- 下一回合焦点：${directorPlan.nextRoundFocus}` : undefined,
        directorPlan.outlineAlignment ? `- 大纲贴合：${directorPlan.outlineAlignment}` : undefined,
        directorPlan.pacingAdvice ? `- 节奏建议：${directorPlan.pacingAdvice}` : undefined,
        directorPlan.riskNotes?.length ? `- 风险：${directorPlan.riskNotes.join('；')}` : undefined,
        '',
        '## 近期方向',
        ...(directorPlan.nextFewRoundsPlan?.length
          ? directorPlan.nextFewRoundsPlan.map((item) => [
            `### 第 ${item.startRound}-${item.endRound} 回合：${item.goal}`,
            item.requiredBeats?.length ? `必达：${item.requiredBeats.join('；')}` : '',
            item.avoidBeats?.length ? `避免：${item.avoidBeats.join('；')}` : '',
            item.revealPolicy ? `揭示策略：${item.revealPolicy}` : '',
          ].filter(Boolean).join('\n'))
          : ['暂无。']),
      ].filter((x) => x !== undefined).join('\n'),
    });
  }

  const settingGuard = state.authorNarrative?.settingGuard;
  if (settingGuard) {
    docs.push({
      saveId: save.id,
      path: 'world/setting-guard.md',
      title: '设定守护记录',
      kind: 'world',
      tags: ['设定守护', '偏离风险', '候选世界书'],
      updatedAtRound: settingGuard.updatedAtRound ?? round,
      updatedBy: 'seed',
      summary: settingGuard.deviation?.description || `设定补丁 ${settingGuard.patches?.length ?? 0} 条。`,
      content: [
        '# 设定守护记录',
        '',
        ...workspaceHeader({
          usage: '记录设定偏离风险、世界书候选补丁和玩家偏好信号。',
          trust: '设定守护者的审校建议；must 级别优先处理，pending 候选不等于正史。',
          update: '候选被玩家接受后再沉淀到 world/canon.md；被拒绝或过期的内容应标注状态。',
        }),
        '',
        settingGuard.deviation
          ? `## 偏离风险\n\n${settingGuard.deviation.description}`
          : '## 偏离风险\n\n暂无。',
        '',
        '## 设定补丁',
        settingGuard.patches?.length
          ? settingGuard.patches.map((p) => `- ${p.severity}｜${p.topic}：${p.advice}`).join('\n')
          : '- 暂无。',
        '',
        '## 待沉淀候选',
        settingGuard.candidates?.length
          ? settingGuard.candidates.map((c) => `- ${c.status}｜${c.name}：${c.content}`).join('\n')
          : '- 暂无。',
        '',
        '## 玩家偏好',
        settingGuard.preference?.tendency || '暂无。',
      ].join('\n'),
    });
  }

  const logicReview = state.authorNarrative?.logicReview;
  if (logicReview) {
    docs.push({
      saveId: save.id,
      path: 'audits/logic-review.md',
      title: '逻辑审校记录',
      kind: 'audit',
      tags: ['逻辑审校', '一致性'],
      updatedAtRound: logicReview.updatedAtRound ?? round,
      updatedBy: 'seed',
      summary: logicReview.overall || `审校问题 ${logicReview.issues?.length ?? 0} 条。`,
      content: [
        '# 逻辑审校记录',
        '',
        ...workspaceHeader({
          usage: '记录人物、场景、时间线、能力、大纲贴合等一致性审校结论。',
          trust: '审校模型输出；作为修复提示，不直接覆盖正文事实。',
          update: '每次审校追加或覆盖当前问题列表；问题被正文修复后应移除或标记已解决。',
        }),
        '',
        logicReview.overall || '暂无总体说明。',
        '',
        '## 问题',
        logicReview.issues?.length
          ? logicReview.issues.map((issue) => [
            `- ${issue.severity}｜${issue.type}：${issue.description}`,
            issue.evidence ? `  - 证据：${issue.evidence}` : '',
            issue.repairHint ? `  - 修复：${issue.repairHint}` : '',
          ].filter(Boolean).join('\n')).join('\n')
          : '- 暂无。',
        '',
        '## 修复指令',
        mdList(logicReview.repairDirectives),
      ].join('\n'),
    });
  }

  const activeEvents = [
    ...(state.authorRandomEventState?.pendingEvent ? [state.authorRandomEventState.pendingEvent] : []),
    ...(state.authorRandomEventState?.activeEvents ?? []),
    ...(state.authorNarrative?.activeArcs ?? []),
  ];
  if (activeEvents.length || state.authorRandomEventState?.completedEvents?.length) {
    docs.push({
      saveId: save.id,
      path: 'timeline/active-events.md',
      title: '当前长线事件 / 事件弧',
      kind: 'timeline',
      tags: ['长线事件', '动态随机事件', '事件弧'],
      updatedAtRound: round,
      updatedBy: 'seed',
      summary: activeEvents.length ? `进行中 ${activeEvents.length} 个事件弧。` : '当前没有进行中事件弧。',
      content: [
        '# 当前长线事件 / 事件弧',
        '',
        ...workspaceHeader({
          usage: '记录动态随机事件、长线事件弧、目标结束回合和当前进度。',
          trust: '事件生成模型和故事正文共同确认；hiddenIntent 不应直接暴露给主角视角。',
          update: '事件推进、完成、取消时更新状态；长线事件应保留阶段进度而非只留一句摘要。',
        }),
        '',
        '## 进行中 / 待触发',
        activeEvents.length
          ? activeEvents.map((arc) => jsonBlock(arc)).join('\n\n')
          : '暂无。',
        '',
        '## 已完成',
        state.authorRandomEventState?.completedEvents?.length
          ? state.authorRandomEventState.completedEvents.map((arc) => `- ${arc.title}：${arc.summary}`).join('\n')
          : '暂无。',
      ].join('\n'),
    });
  }

  const eventByKey = new Map<string, StoryArc>();
  for (const arc of [
    ...activeEvents,
    ...(state.authorRandomEventState?.completedEvents ?? []),
  ]) {
    const key = arc.id || arc.title;
    if (!key) continue;
    const previous = eventByKey.get(key);
    eventByKey.set(key, previous ? { ...previous, ...arc } : arc);
  }
  for (const arc of eventByKey.values()) {
    docs.push({
      saveId: save.id,
      path: `timeline/events/${safePathPart(arc.title, arc.id || '未命名事件')}.md`,
      title: `${arc.title} · 事件档案`,
      kind: 'timeline',
      tags: ['事件', arc.type, arc.lifecycle ?? arc.status].filter(Boolean),
      updatedAtRound: arc.updatedAtRound ?? round,
      updatedBy: 'seed',
      summary: arc.summary || arc.directive || `${arc.title} 的事件档案。`,
      content: eventDoc(arc),
      archived: arc.status === 'completed' || arc.lifecycle === 'archived' || arc.lifecycle === 'completed' || undefined,
    });
  }

  docs.push({
    saveId: save.id,
    path: 'memory/summary.md',
    title: '上下文摘要',
    kind: 'memory',
    tags: ['摘要', '上下文'],
    updatedAtRound: round,
    updatedBy: 'seed',
    summary: '由摘要模型维护的长期上下文压缩结果。',
    content: [
      '# 上下文摘要',
      '',
      ...workspaceHeader({
        usage: '压缩较早聊天记录，帮助模型在低成本下理解前情。',
        trust: '摘要模型产物；若与完整聊天记录冲突，以完整聊天记录为准。',
        update: '只保留影响后续理解的事件、决定、角色变化和未解决线索；避免流水账。',
      }),
      '',
      state.summary?.trim() || '暂无摘要。',
    ].join('\n'),
  });

  docs.push({
    saveId: save.id,
    path: 'memory/long-term.md',
    title: '长期记忆',
    kind: 'memory',
    tags: ['长期记忆', '一致性'],
    updatedAtRound: state.lastMemoryRound ?? round,
    updatedBy: 'seed',
    summary: '外观、服装、承诺、线索、关系等需要长期保持一致的事实。',
    content: [
      '# 长期记忆',
      '',
      ...workspaceHeader({
        usage: '保存外观、服装、承诺、伏笔、关系、主角已知事实等长期一致性信息。',
        trust: '记忆模型整理；主角不知道的信息不要写成主角已知。',
        update: '每次整理时合并同类事实，删除过期状态，保留“上次见面/常态/猜测”的区别。',
      }),
      '',
      state.longTermMemory?.trim() || '暂无长期记忆。',
    ].join('\n'),
  });

  if (resources.worldBooks?.length) {
    docs.push({
      saveId: save.id,
      path: 'world/canon.md',
      title: '世界正史 / 世界书汇总',
      kind: 'world',
      tags: ['世界书', '正史'],
      updatedAtRound: round,
      updatedBy: 'seed',
      summary: '当前旅程挂载的世界书条目汇总。',
      content: [
        '# 世界正史 / 世界书汇总',
        '',
        ...workspaceHeader({
          usage: '汇总当前旅程挂载的世界书和已接受设定，是世界观硬约束的主要入口。',
          trust: 'alwaysActive 条目与玩家接受的补丁优先；关键词条目在相关剧情中生效。',
          update: '新增世界设定时写清来源和适用范围；未确认候选留在 setting-guard，不直接进正史。',
        }),
        '',
        ...resources.worldBooks.map((book) => [
          `## ${book.name}`,
          '',
          book.description || '',
          '',
          ...book.entries.map((entry) => [
            `### ${entry.name}`,
            `- 关键词：${entry.alwaysActive ? '常驻' : entry.keywords.join(' / ') || '无'}`,
            `- 优先级：${entry.priority ?? 0}`,
            '',
            entry.content,
          ].join('\n')),
        ].join('\n')),
      ].join('\n\n---\n\n'),
    });
  }

  for (const npc of state.npcs ?? []) {
    docs.push({
      saveId: save.id,
      path: `characters/${safePathPart(npc.name, npc.id)}/profile.md`,
      title: `${npc.name} · 人物档案`,
      kind: 'character',
      tags: ['角色', npc.role ?? ''].filter(Boolean),
      updatedAtRound: npc.lastRound ?? round,
      updatedBy: 'seed',
      summary: npc.description || npc.role || `${npc.name} 的人物档案。`,
      content: npcDoc(npc),
    });
  }

  const scenes = [
    ...(state.currentScene ? [state.currentScene] : []),
    ...(state.availableScenes ?? []),
    ...(state.sceneHistory ?? []),
  ];
  const sceneByName = new Map<string, SceneRef>();
  for (const scene of scenes) {
    const name = scene.name?.trim();
    if (!name) continue;
    sceneByName.set(name, { ...sceneByName.get(name), ...scene, name });
  }
  for (const scene of sceneByName.values()) {
    docs.push({
      saveId: save.id,
      path: `scenes/${safePathPart(scene.name, '未命名场景')}.md`,
      title: `${scene.name} · 场景`,
      kind: 'scene',
      tags: ['场景'],
      updatedAtRound: round,
      updatedBy: 'seed',
      summary: scene.description || `${scene.name} 的场景记录。`,
      content: sceneDoc(scene),
    });
  }

  docs.push({
    saveId: save.id,
    path: 'inventory/backpack.md',
    title: '能力',
    kind: 'inventory',
    tags: ['能力'],
    updatedAtRound: round,
    updatedBy: 'seed',
    summary: `当前掌握 ${state.backpack?.length ?? 0} 项能力。`,
    content: [
      '# 能力',
      '',
      ...workspaceHeader({
        usage: '记录主角当前掌握或刚觉醒/失效的能力，以及能力对剧情的可用性。',
        trust: '以决策模型和正文共同确认的能力状态为准。',
        update: '觉醒、获得、失效、升级能力时更新；不要保留已失效的临时授予项。',
      }),
      '',
      ...(state.backpack?.length
        ? state.backpack.map((item) => [
          `## ${item.name}`,
          `- 类型：${item.type}`,
          `- 获得回合：${item.acquiredAtRound}`,
          item.pendingDestroy ? `- 待失效：${item.destroyReason || '是'}` : undefined,
          '',
          item.description,
        ].filter(Boolean).join('\n'))
        : ['暂无能力。']),
    ].join('\n'),
  });

  for (const item of state.backpack ?? []) {
    docs.push({
      saveId: save.id,
      path: `inventory/items/${safePathPart(item.name, item.id)}/item.md`,
      title: `${item.name} · 能力档案`,
      kind: 'inventory',
      tags: ['能力', item.type, item.pendingDestroy ? '待失效' : '掌握中'].filter(Boolean),
      updatedAtRound: item.pendingDestroy ? round : item.acquiredAtRound ?? round,
      updatedBy: 'seed',
      summary: item.description || `${item.name} 的能力档案。`,
      content: itemDoc(item),
      stale: item.pendingDestroy || undefined,
    });
  }

  return docs;
}

export async function seedWorkspaceDocumentsFromSave(
  save: GameSave,
  resources: WorkspaceSeedResources = {},
  options: { overwrite?: boolean; refreshSeeded?: boolean } = {},
): Promise<{ created: number; updated: number; skipped: number }> {
  const docs = buildWorkspaceSeedDocuments(save, resources);
  const desiredPaths = new Set(docs.map((doc) => doc.path.replace(/\\/g, '/')));
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const doc of docs) {
    const existing = await getWorkspaceDocumentByPath(save.id, doc.path);
    const canUpdate = options.overwrite || (options.refreshSeeded && existing?.updatedBy === 'seed');
    if (existing && !canUpdate) {
      skipped += 1;
      continue;
    }
    await createWorkspaceDocument(doc);
    if (existing) updated += 1;
    else created += 1;
  }
  if (options.refreshSeeded) {
    const entityPrefixes = [
      'characters/',
      'inventory/items/',
      'scenes/',
      'timeline/events/',
    ];
    const existingDocs = await getWorkspaceDocuments(save.id);
    for (const doc of existingDocs) {
      if (doc.updatedBy !== 'seed') continue;
      if (desiredPaths.has(doc.path)) continue;
      if (!entityPrefixes.some((prefix) => doc.path.startsWith(prefix))) continue;
      await patchWorkspaceDocument(doc.id, {
        stale: true,
        archived: true,
        updatedAtRound: save.state.currentRound ?? doc.updatedAtRound,
        updatedBy: 'seed',
        provenance: {
          ...(doc.provenance ?? {}),
          round: save.state.currentRound ?? doc.updatedAtRound,
          note: 'seed refresh: entity no longer appears in current save state',
        },
      });
      updated += 1;
    }
  }
  return { created, updated, skipped };
}
