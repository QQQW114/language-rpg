# 模型链路可视化前端改造需求

> 用途：交给一个**新的 Claude Code 会话**实现，与提示词调优会话隔离。
> 改造对象：故事 Agent 回合内的模型调用 / 工具调用前端展示。
> 当前状态：基础版已运行（`streamingToolEvents` + `ToolActivityList` + `pushFlowEvent` + `setAgentBusyFlow`），但视觉粗糙、缺嵌套结构、缺回合结束后的优雅收束。

## 一、目的

把回合进行中的"模型链路 + 工具调用"展示从"一行一条的扁平列表"升级为：

1. **进行中**：嵌套折叠卡，父节点是模型（司辰 / 司事 / 导演 / 故事写手等），子节点是它调用的工具与子模型。
2. **回合结束**：完全收起到回合卡角落的一个小图标 + 一行总结；点击图标展开"记录页"看完整链路。
3. **流畅动画**：父节点切换 / 子节点展开 / 状态切换（running → completed / failed）都要平滑。

## 二、设计参照

风格不卡死，给两个方向作为感觉参照：

1. **Claude.ai 思考过程折叠卡片**：低饱和容器 + 旋转 chevron + 平滑展开。父节点收起时只显示一行（图标 + 模型名 + 状态 + 简短摘要）。
2. **Claude Code 工具调用 chip**：紧凑、带状态光晕（running 时柔光呼吸）、完成时变成静态 chip 含执行时间。

颜色基调：**保留现有暗色 + 金色金线主题**（项目主题已与 Claude 官网风格契合）。新组件复用现有 token：`gold` / `gold-light` / `parchment-200/...` / `bg-parchment-900/...`。无需引入新主题。

## 三、关键概念地图

实现前必须理解以下数据流。所有相关代码已在仓库中。

### 3.1 核心类型

```ts
// src/types/game.ts
export interface ToolActivityRecord {
  id: string;
  name: string;             // 工具名或模型 key，例：'run_character_analysis' / 'set_npc_affinity' / 'orchestrator'
  label: string;            // 中文显示文本，例：'询问人物规划员：小晴是否应登场'
  detail?: string;          // 完整参数 / 结果（hover / 展开时显示）
  actor?: string;           // 谁触发的，例：'回合司辰' / '司事' / '故事写手'
  phase?: 'read' | 'write' | 'call' | 'result' | 'status';
  createdAt: number;        // 时间戳
}

export interface Message {
  // ...
  toolEvents?: ToolActivityRecord[];   // 该回合所有活动落盘到消息上
}
```

```ts
// src/services/llmClient.ts
export interface ChatToolActivity {
  phase: 'call' | 'result';
  call: ChatToolInvocation;   // { id, name, arguments }
  resultText?: string;
}
```

### 3.2 状态枚举（AgentBusyKind）

模型 / 阶段共 17 个种类，定义在 `src/pages/GamePage.tsx` 第 67 行附近：

```
orchestrator / outlineMapper / stageJudge / settingGuard / eventBeat /
director / logicCheck / memory / memoryNow / summary /
characterPlanner / scenePlanner / eventPlanner /
story / decisionWithChoices / decisionTracking /
randomEvent / masterArc / review
```

`agentBusy: AgentBusyKind | null` 表示当前活跃的模型。`setAgentBusyFlow(kind, action)` 同时 push 一个 phase='status' 的 ToolActivityRecord 到 streaming 列表。

### 3.3 触发与生命周期

- **模型开始**：`setAgentBusyFlow('orchestrator', '判断本回合需要哪些模型')` → push 一条 status 事件 + 设 agentBusy。
- **工具调用前**：LLM 决定调工具时，`llmClient` 内触发 `onToolActivity({ phase: 'call', call })` → GamePage 里的 callback 把它 push 成 phase='call' 事件。
- **工具调用后**：拿到工具返回值，触发 `onToolActivity({ phase: 'result', call, resultText })` → push 成 phase='result'。
- **模型结束**：下一个 `setAgentBusyFlow` 覆盖（或清空 agentBusy）。
- **回合结束**：`streamingToolEventsRef.current` 被持久化为 `Message.toolEvents` 写进消息历史，并清空当前流。

### 3.4 现有展示

- `src/components/StoryView.tsx` 中的 `ToolActivityList`：当前回合流式（第 272 行）+ 历史回合卡（第 130 行）。
- 当前样式：一行一条，前缀金色 ✦，actor 高亮金色，label 灰白。无嵌套，无折叠，无动画。

## 四、模型 / 工具中文名映射

新 UI 要按这套映射显示。命名权威以本文档为准。

### 4.1 模型（actor / 父节点名）

| key (AgentBusyKind) | 中文显示名 | 一句话角色 |
|---|---|---|
| `orchestrator` | 回合司辰 | 调度者，决定本回合调用哪些模型 |
| `orchestrator-phase1` | 司辰·信息整理 | 司辰双 Phase 的第一轮（信息整理） |
| `orchestrator-phase2` | 司辰·调度决策 | 司辰双 Phase 的第二轮（输出 calls 决策） |
| `outlineMapper` | 大纲映射员 | 当前剧情↔大纲贴合度与 milestone 时机 |
| `stageJudge` | 阶段判断员 | 玩家意图 / 节奏 / 阶段推进 |
| `settingGuard` | 设定守护者 | 世界书 / 设定一致性 |
| `eventBeat` | 司事 | 事件节奏判定 + 结算 |
| `director` | 叙事导演 | 整合规划成 writingBrief |
| `characterPlanner` | 人物规划员 | A 类子模型，被司辰按需调 |
| `scenePlanner` | 场景规划员 | A 类子模型 |
| `eventPlanner` | 事件规划员 | A 类子模型 |
| `logicCheck` | 逻辑审校员 | 故事后的连续性审查 |
| `memory` | 记忆整理员 | 长期记忆维护 |
| `memoryNow` | 立即记忆整理 | 玩家手动触发 |
| `summary` | 摘要压缩 | 历史压缩 |
| `story` | 故事写手 | 写当前回合正文 |
| `decisionWithChoices` | 决策与选项 | 状态提取 + 候选选项 |
| `decisionTracking` | 决策状态 | 仅状态提取，不生成选项 |
| `randomEvent` | 长线事件 | 旧随机事件链路（弃用中，仍可能出现） |
| `masterArc` | 主弧生成 | 开局生成或主弧未就位时 |
| `review` | 旅程评阅 | 结局回看 |

**注意**：双 Phase 司辰的两轮在数据流上目前共用同一个 `AgentBusyKind = 'orchestrator'`（service 层 `runOrchestratorPhase1` / `runOrchestratorPhase2` 串行运行，没有切 busy 状态）。新 UI 若要区分两轮，**两种方案二选一**：

- **方案 A（推荐）**：在 `pushFlowEvent` 里 actor 字段直接写 `'司辰·信息整理'` / `'司辰·调度决策'`，按 actor 文本聚合显示。需要在 `runOrchestratorPhase1` / `runOrchestratorPhase2` 的 `onToolActivity` callback 里加 actor 切换。
- **方案 B**：扩展 `AgentBusyKind` 加入 `'orchestratorPhase1'` / `'orchestratorPhase2'`，并修改 service 在两轮之间发 status 事件。改动更大。

推荐 A——改动小、对其他链路无侵入。

### 4.2 工具（子节点 label 候选）

`src/components/StoryView.tsx` 第 308 行 `toolNameLabel` 函数已经维护了一份映射，请直接复用并补全。本次需要确保以下司事 / 事件弧相关工具有中文名：

| name | label |
|---|---|
| `run_character_analysis` | 询问人物规划员 |
| `run_scene_analysis` | 询问场景规划员 |
| `run_event_analysis` | 询问事件规划员 |
| `get_active_arcs` | 查阅了进行中的事件弧 |
| `get_npc_list` | 查阅了 NPC 列表 |
| `get_npc_detail` | 查阅了 NPC 档案 |
| `get_recent_rounds` | 查阅了最近 N 回合 |
| `set_npc_affinity` | 调整了 NPC 好感 |
| `add_npc_note` | 给 NPC 加了备注 |
| `grant_minor_item` | 授予了事件内能力 / 道具 |
| `update_item_note` | 更新了能力 / 物品备注 |

A 类分析（`run_*_analysis`）的 label 应携带 `args.question` 或 `args.focus`，例：`询问人物规划员：小晴是否应登场`。`GamePage.tsx` 第 744 行已经在做这件事，沿用即可。

修改 NPC 类工具（`set_npc_affinity` / `add_npc_note` / `grant_minor_item`）应在 label 后带具体目标，例：`调整 小晴 好感 +12`。这一段需要新写。

### 4.3 调度排序参考

司辰的 `OrchestratorState.callOrder` 字段定义本回合调用顺序，UI 父节点可按此排序：

```
outlineMapper → stageJudge / settingGuard → eventBeat → director → logicCheck → memory → summary → story
```

司辰自身在最前；A 类子模型作为司辰的子节点；故事写手在最后。

## 五、视觉与交互需求

### 5.1 进行中（当前回合）

**位置**：保留现有插入点 `StoryView.tsx` 第 272 行（流式区上方）。

**结构**：树状嵌套折叠卡。

```
┌─ 回合司辰·信息整理   running  · · ·          [▾]
│   └─ 询问人物规划员：小晴是否应登场     done   ·       [▸]
│   └─ 查阅了最近 5 回合                  done   ·       [▸]
├─ 回合司辰·调度决策   completed  ·                    [▸]
├─ 阶段判断员           completed  ·                    [▸]
├─ 司事                 running  · · ·                  [▾]
│   └─ 查阅了进行中的事件弧            done   ·         [▸]
│   └─ 调整 小晴 好感 +12              done   ·         [▸]
├─ 叙事导演             pending                        [—]
└─ 故事写手             pending                        [—]
```

**父节点**默认折叠（只显示模型名 + 状态 + 一行最关键的 hint/概要）；当前 running 的父节点自动展开。点击父节点切换展开/折叠。

**状态显示**：running 用呼吸光晕动画（金色），completed 用静态金线 chip，failed 用低饱和红色。

**子节点**展开时显示 label + detail（detail 长则截断 + tooltip 全文）。子节点不再嵌套（最多两层）。

**动画**：
- 父节点展开/折叠：高度 transition + chevron 旋转，时长 200-280ms，缓动 `cubic-bezier(0.4, 0, 0.2, 1)`。
- 新子节点 push 进来：淡入 + 轻微上滑（10-12px）。
- running 光晕：柔和 1.2s 呼吸（透明度 0.6↔1）。

### 5.2 回合结束后（历史回合卡）

**位置**：现有 `StoryView.tsx` 第 130 行的 `events={m.toolEvents}` 是历史回合的工具事件渲染点，但要把它从"完整列表"改为"图标 + 单行总结"。

**收束形态**：每条历史消息卡的顶部 / 角落显示一个**小图标 + 一行总结**，例：

```
✦ 司辰 → 大纲映射 → 阶段判断 → 司事 → 导演 → 故事       8 步·12 工具
```

点击该行 → 弹出 / 展开记录抽屉（参考 Claude.ai 的 thinking 折叠展开）显示完整树状链路。

**抽屉**：可以是 inline 展开（推下方内容），也可以是右侧 Sheet / Modal——由实现者选。倾向 inline 展开以保持上下文连续。

### 5.3 失败 / 中断状态

- 工具调用返回错误：子节点显示红色，label 末尾加"失败"，detail 含错误文本。
- 模型整体失败：父节点状态 failed，自动展开显示子节点定位错误点。
- 玩家中断（AbortError）：父节点显示"已取消"（灰色），不显示为 failed。

## 六、需要新增 / 改动的代码

### 6.1 数据层

1. **`pushFlowEvent` 扩展（src/pages/GamePage.tsx ~441 行）**
   - 新增字段 `parent?: string`：用于把子工具事件归属到父模型。当前所有 onToolActivity 都用 actor 命名实际触发模型（如 `'回合司辰'`），新 UI 可以按 actor 自动归属。无需新增 parent 字段也能工作，但建议加上以避免 actor 文本歧义。

2. **司辰双 Phase 切换 actor（src/services/authorOrchestratorAgent.ts）**
   - `runOrchestratorPhase1` 调用 onToolActivity 时，让 callback 知道当前是 Phase 1 → GamePage 的 callback 把 actor 写成 `'司辰·信息整理'`。
   - `runOrchestratorPhase2` 同理写 `'司辰·调度决策'`。
   - 实现方式：service 多传一个 `phaseLabel` 字符串给上层，或上层在两轮之间各注入一个 phase=status 的 marker 事件。**推荐**让 service 把 phaseLabel 作为 onToolActivity 第二个参数透传，最小侵入。

3. **司事工具 label 完善（src/components/StoryView.tsx `toolNameLabel`）**
   - 第 308 行补齐 `set_npc_affinity` / `add_npc_note` / `grant_minor_item` / `update_item_note` / `get_npc_list` / `get_npc_detail` 的中文名。
   - GamePage `requestAuthorEventBeat` 的 onToolActivity callback（第 1179 行附近）应解析 `args.npcName` / `args.delta` / `args.name` 拼出更详细的 label，例：`调整 小晴 好感 +12（理由：旧街约会收束）`。

### 6.2 组件层

1. **`ToolActivityList` 重构** → 拆为两个组件：
   - `<AgentFlowTree>`：进行中的嵌套树状展示。从 `streamingToolEvents` + `agentBusy` 派生父子结构。
   - `<AgentFlowSummary>`：历史回合卡上的"图标 + 单行总结 + 可展开"形态。
2. **聚合逻辑**：
   - 父子推断：按事件 actor 文本聚合。新一条 actor 与上一条不同 → 开新父节点。phase='status' 表示模型开始 → push 父节点 header。phase='call' / 'result' 表示工具调用 → 归到当前父节点下。
   - **父节点状态**：父节点最后一个事件 phase='status' 后无后续 → running；有 'result' 但无新 'status' 切换 → completed；有错误 → failed。
   - **去重**：phase='call' 与紧随的 phase='result' 同 name 同 args 可合并成一个子节点（call 标记进入，result 标记完成 + 持续时间）。
3. **动画库选择**：推荐 `framer-motion`（如果项目已用则复用；否则用 Tailwind transition + CSS keyframes 也够）。先看 `package.json` 决定。

### 6.3 不需要改动

- 不要改 service 层的 onToolActivity 触发逻辑（只在 6.1.2 加 phase label 透传）。
- 不要改 ToolActivityRecord 持久化结构（向后兼容）。
- 不要改 prompt 文件。
- 不要改 AgentThought 记录机制（侧栏的"模型记录页"另一套，不在本期范围）。

## 七、现有代码定位（接手时先读这几处）

| 文件 | 行号附近 | 内容 |
|---|---|---|
| `src/pages/GamePage.tsx` | 67-86 | `AgentBusyKind` 枚举 |
| `src/pages/GamePage.tsx` | 401-465 | `streamingToolEvents` state、`pushFlowEvent`、`setAgentBusyFlow` |
| `src/pages/GamePage.tsx` | 740-763 | 司辰的 onToolActivity 实现样板 |
| `src/pages/GamePage.tsx` | 1160-1222 | 司事的 setAgentBusyFlow + onToolActivity 样板 |
| `src/pages/GamePage.tsx` | 1629-1664 | 故事写手的 onToolActivity + toolEvents 持久化 |
| `src/pages/GamePage.tsx` | 2317 | streamingToolEvents prop 传给 StoryView |
| `src/components/StoryView.tsx` | 130 | 历史回合卡上的 ToolActivityList |
| `src/components/StoryView.tsx` | 272 | 流式区上方的 ToolActivityList |
| `src/components/StoryView.tsx` | 285-306 | `ToolActivityList` 组件实现（要重构） |
| `src/components/StoryView.tsx` | 308-338 | `toolNameLabel` 工具名映射 |
| `src/services/authorOrchestratorAgent.ts` | 483-568 | 司辰双 Phase 实现（要透传 phaseLabel） |
| `src/services/llmClient.ts` | 53-57, 75 | `ChatToolActivity` 类型 + `onToolActivity` 入口 |
| `src/types/game.ts` | 598-614 | `ToolActivityRecord` / `Message.toolEvents` 类型 |

## 八、验收清单

- [ ] 当前回合开始一个新模型时，进行中卡片新增一个父节点，平滑插入（淡入 + 上滑）。
- [ ] running 父节点带柔和呼吸光晕，状态切换 completed 时光晕消失换静态 chip。
- [ ] 司辰的 17 类模型 + 司事 / 事件弧的新工具都有正确中文名。
- [ ] 双 Phase 司辰显示为两个独立父节点（actor 区分），各自有自己的子工具树。
- [ ] 司辰调 A 类子模型（run_character_analysis 等）显示为司辰下的子节点，label 含 question 摘要。
- [ ] 司事调修改类工具（set_npc_affinity / grant_minor_item 等）显示为司事下的子节点，label 含目标对象 + delta + 简短理由。
- [ ] 父节点点击折叠 / 展开有平滑动画（200-280ms，正确缓动）。
- [ ] 当前 running 父节点默认展开；非 running 父节点默认折叠。
- [ ] 失败工具调用子节点显示红色 + "失败" 文本 + tooltip 错误详情。
- [ ] 玩家中断显示为"已取消"灰色而非失败红色。
- [ ] 回合结束后，主界面回合卡只显示一行总结（图标 + 模型链 + 步数）。
- [ ] 点击总结行展开完整链路记录，再次点击折叠。
- [ ] 暗色 + 金色主题与现有 UI 一致，不出现违和的颜色块。
- [ ] 现有 `Message.toolEvents` 数据结构保持向后兼容，旧存档加载时仍可显示。
- [ ] 类型检查 / lint 通过；现有回合记录页（侧边栏 AgentThoughtsPanel）不受影响。

## 九、给新会话的开场建议

把本文件作为第一个 attachment 给新 Claude Code，并附加以下指引：

> 1. 先完整读 `docs/agent-flow-ui-redesign-brief.md`（本文件）。
> 2. 然后读"现有代码定位"列出的所有文件，建立数据流心智模型。
> 3. 不要改 prompt 文件、不要改 service 层的工具调用逻辑（除"6.1.2 phaseLabel 透传"一处）。
> 4. 实现前先用 EnterPlanMode 出一份具体实现计划（拆 commit / 拆步骤）。
> 5. 风格不卡死，视觉感觉对齐 Claude.ai 思考折叠卡 + Claude Code 工具 chip 即可。
> 6. 如本文档与现状有矛盾，**以现状为准**，并在 PR 描述里指出文档需修订之处。

## 十、本期不做的事

- 不做侧边栏 `AgentThoughtsPanel` 的改造（那是另一套"模型记录页"，存放完整 prompt / output / thinking）。
- 不做记录页的归档 / 导出。
- 不做工具调用的实时 token 速率显示。
- 不做模型耗时 / token 用量大屏统计。
- 不做主题切换 / 亮色模式适配（保持暗色）。

以上四项是后续可选项，不影响本期上线。
