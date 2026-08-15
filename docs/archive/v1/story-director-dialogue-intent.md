# 故事写手↔导演双向问询系统提示词与架构意图记录

> 记录时间：2026-05-11
> 用途：本文档是「故事↔导演双向问询机制」（含 `ask_director` 工具、二次导演调用、工具集精简）的执行意图记录，给后续精修提示词的模型 / 维护者读取。
> 当前状态：用户主改提示词；维护侧按本文档列出的代码改造清单干代码改造，不主动改写 prompt 主体。

## 总体方向

跑通一轮后发现的根因（详见 `MEMORY.md → project_story_director_role_redesign`）：故事写手「乱发挥」实为执行无误，根因在分工模型——多模型并列下游 story + 信息层层展开无人减熵 + 故事遇到信息空缺只能自己脑补整合。

新方向：**故事↔导演的二次问询机制**——让故事在剧情复杂场景下主动询问导演，而不是自己脑补。

- **主流路径**（常态）：导演第一次调用即明确指挥故事（写哪、哪些角色、要点几条），故事按指挥渲染。
- **异常路径**（剧情复杂时）：故事调用 `ask_director` 工具一次，触发独立的二次导演调用，注入答复后故事继续。

这条路径选择背景见决策记录："不大砍工具，靠 prompt + ask_director 兜底解决剧情复杂场景，比 brute force 工具收紧优雅"。是路径 1（轻量加强）方案。

## 提示词协作约定

延续 `orchestrator-prompt-intent.md` 第 2 节"提示词协作约定"。维护模型不要擅自改写本文涉及到的 prompt 主体，只按用户明确指定的部分修改。新增 `authorDirectorReplySystem.ts` 的 prompt 由用户负责落地。

## 设计原则

1. **导演第一次就要把活做到位**——明确告诉故事写手该写哪、哪些角色怎么样、要点是什么。`ask_director` 是兜底，不是日常工具。
2. **二次导演调用是独立 agent call**——按 calls 记录系统统一存储，UI 独立呈现，不藏在故事的 `tool_call` 里。
3. **工具说明保持原职责描述**——不要在每个工具说明里都加"优先 ask_director"，避免培养故事频繁求助的习惯。`ask_director` 自己的工具说明里定位"剧情复杂场景的兜底"，其他工具维持原职责。
4. **答复正向约束**——"使用精炼的回答"，不硬限字数。
5. **二次导演只允许一轮工具补查**——`maxToolRounds=1`，避免任性二刷大量重复查询。
6. **一次性硬卡**——工具调用层加计数器，本回合 `ask_director` 计数 ≥1 时拒绝。

## 完整流程

### 时序图

```
回合开始
  ↓
... 司辰 Phase 1+2 / outlineMapper / stageJudge / settingGuard / planners / 司事 ...
  ↓
[导演第一次调用]
  system = AUTHOR_DIRECTOR_SYSTEM (加强「明确指挥」职责段)
  user   = 完整 brief + 所有上游模型输出
  工具循环：可调任意自身允许的工具 (maxToolRounds=3 维持)
  输出：writingBrief (明确指挥版本)
  → 保存为独立 agent call (kind='director')，完整 messages 历史
  ↓
[故事第一次调用]
  system = STORY_SYSTEM (含 ask_director 工具说明)
  user   = 当前 brief + 故事输入
  工具：精简后的故事工具集 + ask_director
  ↓
  分支：
  
  A) 故事顺利 → 直接输出正文 → 回合结束
  
  B) 故事识别到信息空缺 → 调用 ask_director(question, missingInfo?)
     ↓
     [触发：导演二次调用]
       从 calls 拉取第一次 director call 的完整 messages 历史
       system = AUTHOR_DIRECTOR_REPLY_SYSTEM (专用短版本)
       messages = [...第一次完整历史..., 追加 user: "故事写手向你提出以下问题：..."]
       maxToolRounds = 1
       → 保存为独立 agent call (kind='directorReply', label='叙事导演 · 回应询问')
     ↓
     导演二次输出 → 注入故事的对话历史作为 tool_result：
       "{导演答复}\n\n（系统提示：导演已完成回复，请参照内容开始创作新一轮故事。）"
     ↓
     故事的循环继续生成正文 → 回合结束
```

### 关键实现说明

#### `ask_director` 是一个特殊工具

从协议层看，它是 OpenAI tool 协议的标准函数调用（故事以 tool_call 形式发起）。但工具实现层不走 `executeWorkspaceTool` 默认路径——它会触发一次完整的子 LLM 调用，类似 orchestrator 的 `run_*_analysis` 模式。

差别：
- `run_*_analysis`：触发新的 agent call（characterPlanner / scenePlanner / eventPlanner），用预设的 system + question 构造 prompt。
- `ask_director`：触发导演的二次调用，复用第一次导演的 messages 历史 + 专用短 system。

#### 一次性硬卡机制

- 工具调用层维护 `currentTurnAskDirectorCount` 计数器（存于本回合 runtime 上下文，回合开始时重置）。
- 计数 ≥1 时调用直接返回错误：
  > 「你已使用此工具，无法第二次使用此工具。请基于现有信息和导演的回复继续创作。」
- 计数器只在故事 agent 的工具循环上下文中维护，不需要持久化到存档（回合结束后重置即可）。

#### messages 历史重建（二次调用核心）

二次导演调用不是从 0 起：
- 从 calls 记录读取本回合**第一次** director call 的完整 messages 数组（含 system / user / 所有工具循环步骤 / 最终 assistant 输出）
- 替换 system 为 `AUTHOR_DIRECTOR_REPLY_SYSTEM`（短版本）
- 在末尾追加 user 消息：「故事写手向你提出以下问题：{question}。{missingInfo ? `故事写手指出缺少以下信息：{missingInfo}` : ''}。请使用精炼的回答补充信息。」
- `maxToolRounds=1`（最多允许导演再调一次工具补查）

#### calls 记录独立呈现

两次导演调用都是独立 agent call：
- 第一次：`kind='director'`，label='叙事导演'
- 第二次：`kind='directorReply'`，label='叙事导演 · 回应询问'
- UI calls 列表显示两个独立条目，时序上紧邻
- 审计链路完整：「导演首次说了什么 → 故事问了什么 → 导演回应了什么 → 故事最终写了什么」

#### prompt cache 影响

- 第一次导演调用：system + user 都进 cache（正常路径）
- 二次导演调用：system 变更（REPLY 版），cache miss；但 REPLY system 设计为短版本（< 500 字），成本可忽略
- messages 历史重发：内容相同，cache 命中部分友好；新追加的 user 是少量增量

## 数据流改动

### state 层

最小化新增字段。本回合 runtime 上下文（不持久化到存档）即可承载：
- `currentTurnAskDirectorCount: number`：本回合 ask_director 计数器

可选展示用字段（持久化到 `authorNarrative`，供前端 UI 知道有这段问询）：
```ts
authorNarrative.directorReply?: {
  callId: string;       // 二次 director call 的 callId
  question: string;
  missingInfo?: string;
  answer: string;
  round: number;
  createdAt: number;
}
```
跨回合自动失效（下回合新一次导演重置）。

### calls 记录扩展

新增 `kind: 'directorReply'`（在 `WorkspaceAgentKind` 中加入），label 默认 `'叙事导演 · 回应询问'`。

其余字段（input / output / thinking / usage / cacheHit / tools）跟其他 agent call 一致。

## 工具规范变动

### 新增工具：`ask_director`

```ts
{
  type: 'function',
  function: {
    name: 'ask_director',
    description: '故事写手专用：当遇到剧情复杂场景（缺角色信息、不清楚设定、剧情有跨节点冲突）、基于当前 brief 写不出合格段落时，向导演提出一次询问。系统会暂停你的创作，触发导演专门答复，然后将答复注入对话由你继续创作。每回合仅可使用 1 次。不要用于细节询问。',
    parameters: {
      type: 'object',
      required: ['question'],
      properties: {
        question: {
          type: 'string',
          description: '具体问题，明确告诉导演你卡在哪里。例如：「我缺少小晴这个角色的信息」「我不清楚主角的能力设定」。',
        },
        missingInfo: {
          type: 'string',
          description: '可选：明确你缺什么类型的信息（如角色、设定、关系、能力等）。',
        },
      },
    },
  },
}
```

### `workspaceTools.ts` 改动清单

1. `WorkspaceToolName` 类型新增 `'ask_director'`
2. 新增 `STORY_DIALOGUE_TOOL_SPECS` 数组（或直接在 STORY 相关分配里加入），含上面的 ask_director spec
3. 修改 `workspaceToolNamesForAgent` 中 `story` 分支：
   - **删**：`search_docs / list_docs / read_doc / get_entity_doc`（底库索引类，转给导演做）
   - **保留**：`get_recent_history / get_latest_director_plan / get_latest_stage_judge / get_npc_list / get_active_arcs / get_latest_event_plan / get_latest_outline_mapping`（基础参考类，故事仍可读最近回合 + 上游精简规划）
   - **新增**：`ask_director`
4. 修改 `workspaceToolNamesForAgent` 中 `director` 分支：
   - **删**：`get_story_briefing`（大返回，只保留给 orchestrator Phase 1 / librarian 用）
   - **保留**：`get_agent_output / get_recent_agent_calls / get_current_round_agent_calls`（跨模型读取按 D 决策保留）
   - **保留**：底库读取（`read_doc / search_docs / list_docs / get_entity_doc`）+ planning state 工具 + outline 等
5. `executeWorkspaceTool` 中**不**为 `ask_director` 添加 case——它由 `storyAgent` 的 onToolCall 钩子专门拦截处理（不走默认路径）

### `WORKSPACE_TOOL_SPECS` 合并

```ts
export const WORKSPACE_TOOL_SPECS: WorkspaceToolSpec[] = [
  ...WORKSPACE_READ_TOOL_SPECS,
  ...ORCHESTRATOR_ANALYSIS_TOOL_SPECS,
  ...EVENT_BEAT_TOOL_SPECS,
  ...STORY_DIALOGUE_TOOL_SPECS,  // 新增
  ...WORKSPACE_WRITE_TOOL_SPECS,
];
```

## 代码改造清单（维护模型负责）

### 1. `src/services/workspaceTools.ts`

- 新增 `'ask_director'` 到 `WorkspaceToolName`
- 新增 `STORY_DIALOGUE_TOOL_SPECS` 数组并合入 `WORKSPACE_TOOL_SPECS`
- 修改 `workspaceToolNamesForAgent`：
  - 修改 `STORY_READ_TOOLS` 列表或新增 `STORY_TOOLS_V2`：删底库索引类 + 加 `ask_director`
  - 修改 `MIDDLE_READ_TOOLS` 或 director 专用列表：删 `get_story_briefing`
- 不在 `executeWorkspaceTool` 中处理 `ask_director`（由调用方拦截）

### 2. `src/services/storyAgent.ts`

核心改动：onToolCall 钩子识别 `ask_director`。

伪代码：
```ts
async function runStoryAgent(/* ... */) {
  let askDirectorCount = 0;  // 回合内计数器

  const onToolCall = async (call: ChatToolCall) => {
    if (call.name === 'ask_director') {
      if (askDirectorCount >= 1) {
        return {
          toolCallId: call.id,
          content: '你已使用此工具，无法第二次使用此工具。请基于现有信息和导演的回复继续创作。',
        };
      }
      askDirectorCount += 1;

      // 1. 读取本回合第一次 director call
      const firstDirectorCall = await findFirstDirectorCallThisRound(save.id, currentRound);
      if (!firstDirectorCall) {
        return { /* error: 找不到第一次 director call */ };
      }

      // 2. 触发二次 director 调用
      const replyResult = await runDirectorReplyAgent({
        save,
        firstDirectorMessages: firstDirectorCall.messages,
        question: call.arguments.question,
        missingInfo: call.arguments.missingInfo,
      });

      // 3. 返回 tool_result（含系统提示）
      return {
        toolCallId: call.id,
        content: `${replyResult.answer}\n\n（系统提示：导演已完成回复，请参照内容开始创作新一轮故事。）`,
      };
    }

    // 其他工具走默认路径
    return executeWorkspaceTool(call.name as WorkspaceToolName, call.arguments, ctx);
  };

  /* ... */
}
```

### 3. `src/services/authorDirectorAgent.ts`

新增 `runDirectorReplyAgent` 函数（或在现有 agent 文件里加入口）：

伪代码：
```ts
export async function runDirectorReplyAgent(params: {
  save: GameSave;
  firstDirectorMessages: ChatMessage[];
  question: string;
  missingInfo?: string;
}): Promise<{ answer: string; callId: string }> {
  const systemReply = AUTHOR_DIRECTOR_REPLY_SYSTEM;
  const userReply = buildDirectorReplyUserPrompt(params.question, params.missingInfo);

  // 替换 system，追加 user
  const messages = [
    { role: 'system', content: systemReply },
    ...params.firstDirectorMessages.filter(m => m.role !== 'system'),
    { role: 'user', content: userReply },
  ];

  // 触发独立 agent call，kind='directorReply'
  const result = await llmClient.chat({
    messages,
    tools: allowedDirectorTools(...),
    maxToolRounds: 1,
    // ...
  });

  // 保存到 calls
  await persistAgentCall({
    saveId: params.save.id,
    kind: 'directorReply',
    label: '叙事导演 · 回应询问',
    round: params.save.state.currentRound,
    input: { system: systemReply, user: userReply, ... },
    output: result.content,
    thinking: result.thinking,
    usage: result.usage,
    /* ... */
  });

  return { answer: result.content, callId: result.callId };
}
```

二次导演调用：
- system 用 `AUTHOR_DIRECTOR_REPLY_SYSTEM`（短版本，由用户编写）
- messages 历史：从第一次导演 call 完整继承（含 tool_calls + tool_results），但 system 替换为 REPLY 版本
- 工具列表：复用第一次 director 的工具集（同样删 get_story_briefing），但 `maxToolRounds=1`
- 输出格式：纯文本（不强制结构化 JSON），由 prompt 引导精炼

### 4. `src/types/workspace.ts` 或对应 types

- `WorkspaceAgentKind` 加 `'directorReply'`
- `AgentCallRecord` / `AgentCallKind` 加 `'directorReply'`
- `AGENT_KIND_LABELS` 加 `directorReply: '叙事导演 · 回应询问'`

### 5. `src/types/content.ts` / `src/types/game.ts` 或对应

- `authorNarrative.directorReply` 可选字段（见上文 state 层）

### 6. calls 记录持久化（`ledgerRepository` 或对应）

- 确保新 kind 能正确入库和查询
- `getAgentCalls` 等查询函数自然支持新 kind，无需特殊处理（kind 是字符串字段）

### 7. 前端展示（独立 UI 改造会话同步）

- `agent-flow-ui-redesign-brief.md` 同步更新：calls 列表识别 `directorReply` kind，独立显示，label 加问询小图标。本会话不主动动前端代码，让用户去找 UI 改造会话同步。

## Prompt 改动清单（用户负责落地）

### 1. `src/prompts/storySystem.ts`

**新增段：`ask_director` 工具使用规范**

放在工具规则段附近。要求包含：
- 何时用：剧情复杂场景（缺角色信息、不清楚设定、跨节点冲突），基于现有 brief 写不出合格段落
- 何时不用：日常细节询问（颜色、姓名拼写、配饰等）
- 使用上限：每回合仅 1 次
- 调用后系统会暂停你的创作，导演答复后由你继续

**新增段：正反例**

正例方向（明确告诉导演"我缺什么"）：
- 「我缺少小晴这个角色的信息（关系、目标、为什么本回合在场）」
- 「我不清楚主角的能力设定（能做什么、限制、本回合能不能用）」
- 「设定守护要求暗示性别翻转的代价，导演 brief 没说本回合是否落地，是否让主角无意中看到镜子？」

反例方向：
- 「我应该怎么开头」（过宽）
- 「小晴眼睛什么颜色」（过细）

**整体定位强化**：
- 强调"你是渲染执行者，按导演指示创作"，不要自己脑补整合多源信息
- **不要**在所有其他工具说明里加"优先 ask_director" —— 这条原则交给 storySystem.ts 整体导向把控，不要影响别的工具说明

### 2. `src/prompts/authorDirectorSystem.ts`

**新增段：明确指挥故事写手**

导演的 writingBrief 必须明确告诉故事写手：
- 本回合写什么场景 / 时段 / 地点
- 哪些角色出场，每个角色的状态、心情、行为倾向
- 写作要点 3~5 条（不是规则清单，是叙事要点）
- 显隐边界：哪些信息可以落、哪些不可暴露
- 节奏：本回合大概多少字、几段

不要含糊（如「看情况推进」），故事写手是按指示渲染，不是自行解读。

**新增段：示例**

良好示例（具体到角色行为 + 显隐边界）：
> 「本回合场景：教室课间 / 10 分钟。出场：曦宇（心情：意外好奇）、小晴（心情：保持距离）。写作要点：①让曦宇试着观察镜面反射 ②小晴主动打招呼但语气微妙 ③不直接揭示性别翻转代价，只通过教室周围他人称呼制造暗示。节奏：约 800 字，3 段。」

差示例（含糊）：
> 「本回合可能涉及小晴出场，故事写手据情况推进。」

### 3. 新增 `src/prompts/authorDirectorReplySystem.ts`

新文件。短系统 prompt，专门用于二次导演调用：

骨架：
```
你是叙事导演。你刚刚完成了本回合的第一次规划，故事写手收到指示后向你提出问题。

任务：使用精炼的回答补充故事写手缺失的信息，让其能够继续创作本回合的故事。

约束：
- 仅回答本次提问，不要重新规划本回合
- 不要扩展到其他议题
- 答复完成即可，无需告知故事写手"开始创作"——系统会自动追加触发指令
- 若需要补查信息可调用工具，但最多一次
```

二次导演的 user prompt 由系统组装（不在 prompt 文件里）：
> 「故事写手向你提出以下问题：{question}。{missingInfo ? `故事写手指出缺少以下信息：{missingInfo}` : ''}。请使用精炼的回答补充信息。」

注：实际落地由用户编写 prompt 主体，本文档只描述骨架与约束。

## 验收清单

### 实现验收（维护模型自检）

- [ ] `workspaceTools.ts`: `ask_director` 工具规范注册
- [ ] `workspaceTools.ts`: story 工具清理（删 `search_docs / list_docs / read_doc / get_entity_doc`，加 `ask_director`）
- [ ] `workspaceTools.ts`: director 工具清理（删 `get_story_briefing`，保留跨模型读取）
- [ ] `workspaceTools.ts`: `ask_director` 在 `executeWorkspaceTool` 中**不**走默认路径
- [ ] `storyAgent.ts`: onToolCall 钩子识别 `ask_director`，触发二次导演调用
- [ ] `storyAgent.ts`: 一次使用计数器
- [ ] `authorDirectorAgent.ts`: 拆出 `runDirectorReplyAgent` 函数
- [ ] types/state: 新 `WorkspaceAgentKind = 'directorReply'`、可选 `authorNarrative.directorReply` 字段
- [ ] calls 记录: `directorReply` kind / label 入库正常

### Prompt 验收（用户负责）

- [ ] `storySystem.ts`: `ask_director` 工具规则段 + 正反例
- [ ] `authorDirectorSystem.ts`: "明确指挥故事写手" 职责段 + 良/差示例
- [ ] `authorDirectorReplySystem.ts`: 新文件，短版本

### 跑通验收（用户手测）

- [ ] 故事顺利时不调 `ask_director`，直接出正文
- [ ] 故事调用 `ask_director` 后，UI 显示独立的「叙事导演 · 回应询问」call
- [ ] 二次导演的答复成功注入故事对话历史，故事继续生成正文
- [ ] 故事尝试调第二次 `ask_director` 时被工具层拒绝
- [ ] calls 记录里能查到完整链路：导演 → 故事 ask → 导演 reply → 故事正文

## 跟现有架构的关系

- **跟司辰双 Phase 互补**：司辰处理"调度决策"，本系统处理"故事↔导演交互"。两者正交。
- **跟司事互补**：司事是事件结算，本系统是写作问询。两者正交。
- **跟「导演升级分镜」暂缓**：路径 1 优先验证 `ask_director` 兜底是否能覆盖剧情复杂场景。如果跑下来发现导演第一次 brief 仍频繁不够清晰、故事高频问询，再升级 `writingBrief.beats[]`。
- **跟前端 UI 改造同步**：见 `agent-flow-ui-redesign-brief.md`——前端要展示独立的二次导演 call 节点，添加问询小图标 / 区别样式。前端工作由独立 claude code 会话处理。

## 风险 / 待观察项

1. **故事问询频率**：如果跑下来故事每回合都问，说明导演第一次 brief 不够明确，需要升级 schema（路径 2，writingBrief.beats[]）。
2. **问题质量漂移**：故事可能问得太宽 / 太细，需观察前几回合调用样本，必要时加强 storySystem.ts 的示例段。
3. **二次导演成本**：每次 `ask_director` 触发完整 director call，token 成本翻倍。但只在异常态触发，可接受。
4. **prompt cache 失效**：二次导演的 system 不同（用 REPLY system），cache miss；但 REPLY system 设计为 < 500 字，影响可忽略。
5. **messages 历史长度**：第一次导演 messages 可能很长（含工具调用历史），二次调用时全部发送，要注意 token 上限。若第一次导演调用 token 已达 80k+，二次还会延续，需观察是否超模型 context 窗口（128k / 200k 视模型而定）。
6. **二次导演工具循环**：`maxToolRounds=1` 允许导演再补查一次，但若导演判断不需要补查就直接答即可。需观察导演的工具调用习惯，必要时收紧到 `maxToolRounds=0`。
