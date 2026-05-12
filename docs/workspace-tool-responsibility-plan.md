# 司书库 / 工具调用 / 模型职责拆分阶段性设想

> 日期：2026-05-11  
> 目的：把最近关于“先拆工具与保存链路，再拆提示词”的想法固化，避免后续上下文清理后丢失方向。  
> 当前约定：先不继续膨胀 prompt；提示词重构前先把工具、司书库地位、模型职责和保存链路理清。故事写手与回合司辰的核心提示词由用户主要把关。

## 1. 当前共识

当前项目如果继续直接改 prompt，容易回到旧问题：每个模型都塞大纲、角色、场景、事件、工具说明、例子与规则，导致 prompt 臃肿、职责混杂、成本高且模型仍可能乱发挥。

因此当前方向改为：

```txt
先拆职责与工具 → 再拆提示词 → 最后再加事件结算/事件生命周期等更复杂模型
```

核心原则：

```txt
小模型是“分析工具”；大模型才是“工具使用者”。
```

小模型不应靠工具自己查资料，而是由系统组好输入，让它只完成窄职责分析；核心模型才需要多轮工具调用与更智能的调度能力。

## 2. 模型分层

### 2.1 核心调度层：回合司辰

地位：最高优先级的故事 agent 调度核心。

职责：

- 判断当前回合属于什么节点：事件内微动作、事件转折、事件完成/失败、新事件候选、阶段切换、回溯补写等。
- 判断哪些小模型需要被调用。
- 判断调用顺序。
- 必要时在任务过程中调用分析模型补充信息，再拿结果复判。
- 控制成本，不是每回合都全模型调用。

需要工具：是，而且是特化工具。

关键能力：**间隔调用能力 / 多轮调度能力**。

示例流程：

```txt
回合司辰初判：本回合可能涉及小晴关系推进与商业街场景资源。
→ 调用人物分析模型
→ 调用场景分析模型
→ 得到结果后再次进入回合司辰
→ 判断是否还需要事件规划 / 大纲映射 / 叙事导演
→ 输出最终调用链与规划强度
```

未来司辰专属工具可包括：

```txt
run_character_analysis
run_scene_analysis
run_event_planning
run_outline_mapping
run_stage_judge
run_setting_guard
run_logic_check
get_latest_planning_bundle
get_recent_rounds
get_story_briefing
read_doc / search_docs（受控）
```

### 2.2 执行写作层：故事写手

地位：正文执行者，不负责整体规划。

职责：

- 读取足够资料。
- 执行导演给出的 writingBrief。
- 严格停在 writingBoundary。
- 不提前揭露 hiddenIntent。
- 不替玩家做超出输入的关键决定。

需要工具：是，但原则上只读。

故事写手需要尽可能完整的读取能力，例如：

```txt
get_story_briefing
get_latest_planning_bundle
get_latest_director_plan
get_active_event_docs
get_entity_doc
read_doc
search_docs
get_recent_rounds
get_current_state
```

禁止/原则：

- 故事写手不写司书库。
- 故事写手不直接改角色、事件、场景、物品正史。
- 它写出的正文进入 history，后续由状态/决策/记忆/司书类模型沉淀为正史。

### 2.3 中型主干模型：主弧 / 设定守护 / 记忆 / 逻辑审校 / 故事主持人等

地位：参与故事生成质量保障，但不一定每回合都调用。

职责较重，可能需要读取足够资料保证质量。

工具策略：固定工具集，不像回合司辰那样自由调度。

示例：

```txt
主弧模型：读大纲、世界书、开局、近期回合、当前状态。
设定守护者：读世界书、canon、长期记忆、最近正文、当前规划。
记忆模型：读最近回合、状态提取、玩家标记、角色/物品/场景变化。
逻辑审校员：读近期正文、规划包、状态、世界书，输出审校问题。
```

写入策略：

- 优先由代码自动保存输出。
- 若需要写司书库，应写候选/审校/记忆区域，而不是直接改正史。

### 2.4 小型分析模型：人物 / 场景 / 玩家意图 / 大纲映射 / 事件规划等

地位：被系统或回合司辰调用的“分析工具”。

工具策略：无工具。

输入方式：由系统组 prompt，保持现在逻辑，但输入块更明确：

```txt
故事大纲：有则给，无则空
主弧：有则给，无则空
大纲映射：有则给，无则空
近期上下文：有则给
长期记忆：有则给
当前场景：有则给
角色状态：有则给
事件状态：有则给
玩家输入：有则给
最新故事片段：有则给
```

输出方式：只输出本模型职责范围内 JSON。

保存方式：代码自动保存为 planning artifact，而不是让模型自己调用工具写入。

示例路径：

```txt
planning/latest/character-plan.json
planning/latest/scene-plan.json
planning/latest/event-plan.json
planning/latest/outline-map.json
planning/latest/stage-judge.json

planning/rounds/12/character-plan.json
planning/rounds/12/scene-plan.json
planning/rounds/12/event-plan.json
planning/rounds/12/outline-map.json
planning/rounds/12/stage-judge.json
```

重点边界：

```txt
分析模型输出不是正史，只是 planning artifact。
```

### 2.5 开始/结束模型：随机生成 / 旅程评价

地位：不直接参与故事生成主循环。

工具策略：无工具。

职责：一次性生成或评价。

## 3. 司书库的目标地位

司书库应成为项目后续的核心保存与调用层，而不是只作为附加资料库。

建议地位：

```txt
司书库 = 当前旅程的实时故事文件系统 / agent 共享工作区
```

它负责承载：

- 长期设定
- 角色档案
- 关系档案
- 场景档案
- 物品档案
- 事件档案
- 主弧 / 导演计划
- 记忆 / 摘要
- 审校记录
- 小模型分析产物
- 临时规划产物

但不同内容有不同可信等级和生命周期。

## 4. 当前保存链路简述

当前 IndexedDB 中主要有：

```txt
saves：存档元信息与运行 state（但 history / agentThoughts 被拆出去）
rounds：按回合保存 history 消息
agentCalls：保存模型调用记录、输入、输出、thinking、usage
snapshots：保存回溯快照
workspaceDocs：司书库文件
```

当前运行链路大致是：

```txt
Zustand state 更新
→ putSaveMeta / persistRuntimeSave
→ history 同步到 rounds
→ agentThoughts 同步到 agentCalls
→ 快照写入 snapshots
→ 司书库 workspaceDocs 由 seedWorkspaceDocumentsFromSave / 手动编辑 / 工具写入维护
```

当前司书库运行时：

```txt
buildWorkspaceToolRuntime(save)
→ seedWorkspaceDocumentsFromSave(save, ..., refreshSeeded=true)
→ 生成/刷新 seed 文档
→ 读取 manifest
→ 追加到模型 user prompt
→ 暴露工具
```

当前已有问题：

- 司书库还不是明确的“主保存层”，更像 ledger 旁边的资料层。
- 运行时每次 buildWorkspaceToolRuntime 都 seed refresh，职责还比较粗。
- 所有启用工具的模型目前倾向拿到同一套工具，权限边界不够细。
- planning artifact 没有统一路径和清理策略。
- agentCalls 保存完整调用，但它偏审计/回溯，不适合作为高频模型读取入口。
- 角色/物品/场景/事件已开始文件化，但“正史 / 规划 / 临时分析 / 审计”边界还需要明确。

## 5. 建议的新保存线路

建议把保存内容分四类。

### 5.1 正史层 / 长期文件

长期保留，供后续模型读取。

路径示例：

```txt
world/canon.md
protagonist/profile.md
characters/小晴/profile.md
relationships/主角-小晴.md
scenes/商业街.md
inventory/items/奶茶券/item.md
timeline/events/商业街约会.md
memory/long-term.md
director/master-arc.md
director/current-plan.md
```

写入来源：

- 玩家手动编辑
- 正文已经发生 + 状态模型提取
- 记忆模型沉淀
- 未来司书/结算模型确认

原则：

```txt
正文发生 + 状态提取 + 记忆/结算沉淀 ≈ 正史
规划模型输出 ≠ 正史
```

### 5.2 规划层 / planning artifact

短中期保留，供回合司辰、导演、故事写手读取。

路径示例：

```txt
planning/latest/orchestrator.json
planning/latest/outline-map.json
planning/latest/stage-judge.json
planning/latest/character-plan.json
planning/latest/scene-plan.json
planning/latest/event-plan.json
planning/latest/director-plan.json

planning/rounds/12/orchestrator.json
planning/rounds/12/character-plan.json
planning/rounds/12/scene-plan.json
planning/rounds/12/event-plan.json
```

写入来源：

- 各小模型输出后由代码自动保存。
- 不要求小模型自己调用写入工具。

清理策略：

- latest 永远保留当前版本。
- rounds 下的临时分析只保留最近 X 回合。
- 超过 X 回合的规划文件可删除、归档或压缩成 summary。

### 5.3 原始审计层 / ledger

用于回溯、调试、导出、复盘，不作为主要模型读取入口。

包括：

```txt
rounds
agentCalls
snapshots
```

保留内容：

- 原始聊天记录。
- 模型输入输出。
- thinking / usage / cache 命中。
- 回滚快照。

原则：

- ledger 是底账，不应每次都全文塞给模型。
- 模型需要读取时，应通过语义工具取近期摘要或特定调用，而不是全量 agentCalls。

### 5.4 运行态 / 临时 state

只保留正在运行所需的短期状态。

例如：

```txt
最近未压缩聊天记录
当前 streaming 状态
当前 phase
当前 selectedItemIds
当前未结算 pending 状态
```

建议未来逐渐减少 state 里长期重复保存的信息，把长期信息转向 workspaceDocs / ledger。

## 6. 工具权限与工具提示块

不建议所有模型共用同一套工具。

应由系统根据当前模型生成一段工具说明：

```txt
【本回合可用工具】
当前模型：回合司辰

可读取：
- get_story_briefing
- get_latest_planning_bundle
- get_recent_rounds

可调用分析模型：
- run_character_analysis
- run_scene_analysis
- run_event_planning

不可用：
- write_entity_doc
- archive_doc
- 直接改 world/canon.md

规则：
- 只调用与当前任务有关的工具。
- 小模型输出是规划，不是正史。
- 若资料冲突，以玩家手写/最新正文/正史文件优先。
```

故事写手的工具块应类似：

```txt
当前模型：故事写手

可读取：
- get_story_briefing
- get_latest_planning_bundle
- get_latest_director_plan
- get_active_event_docs
- read_doc
- search_docs
- get_recent_rounds

不可用：
- write_doc
- write_entity_doc
- archive_doc

规则：
- 你只写正文，不修改司书库。
- 你执行 writingBrief，并停在 writingBoundary。
```

## 7. 语义读取工具建议

为了避免模型猜路径，建议增加语义工具：

```txt
get_latest_planning_bundle
get_latest_character_plan
get_latest_scene_plan
get_latest_event_plan
get_latest_outline_mapping
get_latest_stage_judge
get_latest_director_plan
get_entity_doc
get_active_event_docs
get_recent_round_summary
```

其中：

```txt
get_latest_planning_bundle
```

可以一次返回：

```json
{
  "orchestrator": {},
  "outlineMapping": {},
  "stageJudge": {},
  "characterPlan": {},
  "scenePlan": {},
  "eventPlan": {},
  "directorPlan": {}
}
```

## 8. 司辰 run_xxx 工具建议

回合司辰未来可以拥有特殊工具，背后触发小模型调用：

```txt
run_character_analysis
run_scene_analysis
run_event_planning
run_outline_mapping
run_stage_judge
run_setting_guard
run_logic_check
```

这些工具行为：

```txt
回合司辰调用 run_character_analysis
→ 系统组人物分析 prompt
→ 人物分析模型运行（无工具）
→ 输出 JSON
→ 自动保存 planning/latest/character-plan.json 与 planning/rounds/N/character-plan.json
→ 将结果返回给回合司辰
→ 回合司辰继续判断下一步
```

这就是“间隔调用能力”。

## 9. 清理策略初稿

建议增加设置项或常量：

```txt
保留 planning/rounds 最近 X 回合，默认 12 或 20。
保留 agentCalls 全量或按用户设置压缩/导出后清理。
保留 rounds 全量，除非用户主动清理。
workspace 正史文件长期保留。
workspace planning 临时文件按策略清理。
```

清理对象优先级：

```txt
1. planning/rounds/* 的旧临时分析文件
2. stale/archived 且 updatedBy=seed 的旧实体文件
3. 过旧 snapshots
4. 过旧 agentCalls 的大输入字段（可只保留 output/usage/summary）
```

不应自动清理：

```txt
玩家手写文件
world/canon.md
characters/*/profile.md
relationships/*
timeline/events/* 的已完成事件总结
memory/long-term.md
```

## 10. 后续实施顺序建议

### Phase A：明确司书库核心地位

- 文档确认 workspaceDocs 是核心故事文件层。
- 明确 ledger 是底账，workspace 是模型读取/沉淀主入口。
- 明确 state 只保留运行态和必要 UI 状态。

### Phase B：planning artifact 自动保存

- 小模型输出后自动写入 planning/latest/*。
- 同时写入 planning/rounds/N/*。
- 不让小模型自己调用写入工具。

### Phase C：语义读取工具

- 实现 get_latest_planning_bundle。
- 实现 get_latest_character_plan / scene / event / outline / stage / director。
- 给故事写手优先开放只读工具。

当前落地状态（2026-05-11）：

- 已实现 `get_latest_planning_bundle`。
- 已实现 `get_latest_character_plan` / `get_latest_scene_plan` / `get_latest_event_plan` / `get_latest_outline_mapping` / `get_latest_stage_judge` / `get_latest_director_plan`。
- 已实现 `get_entity_doc` 与 `get_active_event_docs`，降低模型猜路径概率。
- 这些工具优先读 `state.authorNarrative` 的最新结果，并尝试附带 `planning/latest/*` 司书库文件；如果后续小模型自动保存尚未接入，也不会影响读取 state 最新规划。

### Phase D：工具权限系统

- buildWorkspaceToolRuntime 支持按 agentKind 返回不同工具集。
- 自动生成【本回合可用工具】说明。
- 故事写手只读。
- 小模型无工具。
- 回合司辰拥有 run_xxx 分析模型工具。

当前落地状态（2026-05-11）：

| 模型层 | 当前工具权限 |
|---|---|
| 回合司辰 | 只读核心工具：司书库、近期回合、近期模型记录、故事资料包、规划包；并拥有 `run_character_analysis` / `run_scene_analysis` / `run_event_analysis` 三个 A 类分析工具 |
| 故事写手 | 只读工具：司书库、故事资料包、实体档案、规划包、近期回合、当前状态 |
| 叙事导演 / 主弧 / 设定守护 / 记忆 / 逻辑审校 | 固定只读工具集 |
| 人物规划 / 场景规划 / 事件规划 / 大纲映射 / 阶段判断 | 无工具；由系统组输入，输出后代码保存到运行态，其中人物 / 场景 / 事件规划可由司辰工具触发 |
| 决策 / 摘要 / 随机事件 / 评价 | 暂无工具，避免每回合成本和职责膨胀 |

说明：

- 目前没有给任何故事主循环模型开放写入工具。
- `write_doc` / `patch_doc` / `append_doc` / `archive_doc` / `write_entity_doc` 仍保留在代码中，但仅作为后续司书/受控写入模型的候选工具，不默认暴露。
- `run_character_analysis` / `run_scene_analysis` / `run_event_analysis` 已接入回合司辰；当前结果会写入 `authorNarrative.characterPlan / scenePlan / eventPlan`，但还没有完整落成独立调用记录与司书库 planning 文件。

### Phase E：回合司辰多轮调度

当前已完成：

- 司辰可通过真实 function calling 调用 `run_character_analysis` / `run_scene_analysis` / `run_event_analysis`。
- 工具参数包含 `question` / `reason` / `focus` / `relatedNames` / `expectedOutput`。
- 工具调用会运行对应 A 类分析模型，并把结果写入当前旅程运行态。
- 工具结果会以简化 JSON 返回给司辰，供同一轮继续判断。

仍需补齐：

1. **A 类工具调用记录落盘**
   - 保存每次工具触发的子模型 input / output / thinking / usage / trace。
   - 记录页能区分“司辰自身输出”和“司辰调用的分析模型输出”。

2. **A 类结果自动写入司书库 planning artifact**
   - 除了写入运行态，还要写入：
     - `planning/latest/character-plan.json`
     - `planning/latest/scene-plan.json`
     - `planning/latest/event-plan.json`
     - `planning/rounds/N/character-plan.json`
     - `planning/rounds/N/scene-plan.json`
     - `planning/rounds/N/event-plan.json`
   - `get_latest_planning_bundle` 可继续优先读取运行态，同时附带这些文件作为可审计记录。

3. **司辰工具调用前端可视化**
   - 回合进行中显示“回合司辰调用了人物/场景/事件分析”，附带问题摘要。
   - 本回合结束后自动折叠进记录，避免正文区域混入工具痕迹。

### Phase F：再回到 prompt

- 这时 prompt 可以变短：只写职责、输出协议、工具使用原则。
- 故事写手和回合司辰提示词由用户主要把关。
- 其他边界模型由维护模型按用户风格整理，用户 review。

## 11. 当前不要做的事

- 不继续无节制扩写所有 prompt。
- 不让所有模型都有写入工具。
- 不让故事写手写司书库。
- 不把小模型规划输出直接当正史。
- 不一口气实现事件结算、关系系统、司书模型等复杂层；先把保存/工具链打稳。
