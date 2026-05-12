# 执笔模式：故事 Agent 与司书库设计

目标：把执笔模式从“固定多模型流水线”升级为纯前端故事 Agent。

项目仍保持纯前端，不引入后端。司书库表现为“文件 / 文件夹”，但实际存储在浏览器 IndexedDB 中，并随旅程卷宗 ZIP 导出 / 导入。

## 总体形态

```text
玩家输入
  ↓
回合司辰判断需要哪些模型 / 哪些资料过期
  ↓
模型获得本回合上下文 + 司书库目录索引，并按需通过工具读取司书库、回合卷宗、其他模型输出
  ↓
专业模型处理自己的任务
  ↓
允许部分模型写入与自己强关联的司书库文件
  ↓
故事模型读取被筛选出的必要资料，生成正文
```

核心原则：

- 司辰负责调度，不负责写剧情。
- 故事模型负责正文，不负责维护资料。
- 专业模型只写与自己强关联的文件。
- 模型默认只拿“目录索引 / 摘要 / 路径 / 最近上下文”，不要把司书库全文一次性塞进 prompt。
- 需要细节时由模型调用 `read_doc` / `search_docs` / `get_agent_output` 等工具主动取。
- 所有写入都进入回合卷宗，可回溯、可导出。

## Prompt 与工具注入方式

为了保持纯前端和控制 token 成本，后续模型调用建议分成三层：

1. **固定 system prompt**：写清模型身份、职责边界、输出协议、可用工具与工具使用规则。
2. **本回合 user context**：写入当前回合必要上下文，例如最近故事、玩家输入、当前场景、时间天气、背包 / 角色摘要、阶段判断、导演计划摘要。
3. **司书库 manifest**：提供当前可读文件的路径、标题、kind、更新时间、短摘要；模型需要全文时再调用工具。

不建议把“司书库当前所有文件全文”提供给所有模型。更推荐提供“所有文件的目录索引 + 可搜索 / 可读取工具”，这样：

- 固定 system prompt 更容易命中缓存；
- 模型不会被无关资料淹没；
- 输入成本更可控；
- 后续可以按模型职责限制可读目录和可写目录。

示例提示：

```text
你可以调用 read_doc(path) 读取司书库文件全文；
可以调用 search_docs(query) 搜索角色、场景、伏笔、导演计划；
可以调用 get_agent_output(callId) 查看本回合或近期其他模型的实际输出。
请先根据 manifest 判断是否需要读取文件，不要读取与任务无关的资料。
```

## 司书库是什么

司书库是一个浏览器内虚拟文件系统：

```text
workspace/
  protagonist/
    background.md
    personality.md
    goals.md

  characters/
    小晴/profile.md
    小晴/relationship-with-protagonist.md
    小晴/appearance.md

  scenes/
    学校天台.md
    旧教学楼.md

  director/
    current-plan.md
    round-001-plan.md
    active-arcs.md

  world/
    canon.md
    pending.md

  timeline/
    main.md
    promises.md

  foreshadowing/
    active.md
    resolved.md

  memory/
    long-term.md
    summary.md

  audits/
    logic-issues.md
    repair-suggestions.md
```

实现类型草案：

```ts
interface WorkspaceDocument {
  id: string;
  saveId: string;
  path: string;
  title: string;
  kind:
    | 'protagonist'
    | 'character'
    | 'relationship'
    | 'scene'
    | 'director'
    | 'world'
    | 'timeline'
    | 'foreshadowing'
    | 'memory'
    | 'audit'
    | 'misc';
  content: string;
  version: number;
  updatedAtRound: number;
  updatedBy: string; // human / orchestrator / director / memory / settingGuard / decision / logicCheck
  provenance?: {
    round?: number;
    agentCallId?: string;
    sourceDocIds?: string[];
  };
}
```

## 工具能力

第一阶段只读：

| 工具 | 作用 |
|---|---|
| `list_docs(path)` | 列出某个目录下的司书库文件 |
| `read_doc(path)` | 读取指定文件 |
| `search_docs(query)` | 在司书库中搜索关键词 |
| `get_recent_rounds(n)` | 读取最近 n 回合 |
| `get_round_record(round)` | 读取指定回合 |
| `get_current_round_agent_calls()` | 读取本回合已经完成的模型调用列表 |
| `get_recent_agent_calls(n)` | 读取最近模型调用链 |
| `get_agent_output(callId)` | 读取某次模型输出 |
| `get_current_state()` | 读取当前 NPC / 背包 / 场景 / 回合短摘要 |
| `get_recent_history(n)` | 读取当前存档里的最近对话 |
| `get_story_briefing(round)` | 读取完整大纲、开局、详细大纲、故事风格、主弧、导演计划、活跃事件 |
| `get_story_outline()` | 读取完整原始大纲与 acts |
| `get_detailed_outline(round)` | 读取严格自定义 / 执笔模式详细大纲 |
| `get_initial_scene()` | 读取开局文本 / startScene |
| `get_background()` | 读取出身与初始角色设定 |
| `get_world_books(includeEntries)` | 读取挂载世界书摘要或正文 |
| `get_journey_content()` | 读取旅程固化配置 |
| `get_author_custom_config()` | 读取严格自定义 / 执笔配置与模板状态 |
| `get_story_style()` | 读取故事长度与风格偏好 |
| `get_master_arc()` | 读取主弧 |
| `get_active_events()` | 读取进行中长线事件 |

第二阶段写入候选：

| 工具 | 作用 |
|---|---|
| `propose_doc_patch(path, patch, reason)` | 提议修改某文件 |
| `create_doc_draft(path, content, reason)` | 创建草稿文件 |
| `append_doc_draft(path, content, reason)` | 追加草稿内容 |

第三阶段受控写入：

| 工具 | 作用 |
|---|---|
| `apply_doc_patch(path, patch)` | 对允许自动写入的文件应用补丁 |
| `replace_doc(path, content)` | 替换允许自动写入的文件 |

写入工具必须记录：

- 哪个模型写入；
- 哪一回合；
- 来源 agentCallId；
- 原文版本；
- 新版本；
- 是否需要玩家确认。

## 模型权限建议

| 模型 | 可读 | 可写 |
|---|---|---|
| 回合司辰 | 司书库目录、当前状态、近期调用、主弧、导演计划 | 不直接写；只决定谁来读 / 写 |
| 故事模型 | 被筛选出的必要资料 | 不写 |
| 决策模型 | 当前状态、角色 / 场景相关文件 | NPC / 背包 / 场景状态文件 |
| 阶段判断员 | 主弧、导演计划、近期回合 | 阶段判断结果文件 |
| 叙事导演 | 主弧、角色关系、时间线、伏笔、近期回合 | `director/*`、`foreshadowing/*` 的计划类文件 |
| 设定守护者 | 世界设定、世界书、近期回合 | `world/pending.md`，必要时提议 `world/canon.md` |
| 记忆模型 | 近期回合、角色资料、场景资料 | `memory/*`、角色细节、承诺、关系摘要 |
| 逻辑审校 | 广泛读取 | `audits/*`，默认不直接修改正史 |
| 司书模型 | 全库读取 | 整理、归档、合并、去重；正史修改按策略确认 |

## 司书模型的方向

司书模型不是调度模型，也不是故事模型。它是“资料库维护者”。

### 它负责

- 整理司书库结构；
- 合并重复文件；
- 把临时草稿归档到合适位置；
- 检查文件是否过期；
- 根据最近剧情建议新增文件；
- 把模型输出转化为稳定资料；
- 维护索引，如角色索引、场景索引、伏笔索引；
- 发现资料冲突，并提出候选修复。

### 它不负责

- 不写故事正文；
- 不直接决定剧情方向；
- 不替阶段判断员分析玩家意图；
- 不替导演规划未来剧情；
- 不无条件改写正史文件。

### 推荐输出

```json
{
  "operations": [
    {
      "type": "create | append | patch | move | archive | mark_stale",
      "path": "characters/小晴/appearance.md",
      "reason": "最近多次出现小晴粉色美甲，需要从回合记录归档为角色外观细节。",
      "requiresConfirmation": false,
      "content": "..."
    }
  ],
  "conflicts": [
    {
      "paths": ["scenes/旧教学楼.md", "timeline/main.md"],
      "description": "旧教学楼首次进入时间存在冲突。",
      "suggestion": "以第 12 回合故事正文为准。"
    }
  ]
}
```

## 司书模型触发时机

不建议每回合调用。由回合司辰判断，或按低频保底触发。

触发信号：

- 多个模型输出提到新增资料；
- 出现新角色 / 新场景 / 新组织；
- 记忆模型写入较多；
- 设定守护者产生 pending 世界书候选；
- 导演计划更新；
- 逻辑审校发现冲突；
- 玩家编辑 / 回溯后需要整理过期文件；
- 每 N 回合低频整理一次。

## 为什么需要司书模型

随着工具调用接入，模型会读取和写入越来越多文件。如果没有司书模型，司书库会逐渐变成“模型日志垃圾堆”：

- 同一人物细节重复记录；
- 草稿和正史混杂；
- 旧导演计划长期占用；
- 世界设定候选没有归档；
- 逻辑审校建议没有后续状态。

司书模型的价值是：

> 把“模型们产生的信息”整理成“模型们后续可以可靠读取的资料库”。

## 实施路线

1. 建立 WorkspaceDocument 存储层。（已落地）
2. 做司书库 UI：文件树 + 文件内容 + 版本 / 来源。（已落地基础版）
3. 把当前长期记忆、导演计划、主弧、逻辑审校结果镜像写入司书库。（已落地 seed / refreshSeeded 基础版）
4. 给回合司辰接只读工具。（已落地，chat 格式启用）
5. 给导演 / 审校 / 阶段判断 / 设定守护 / 动态事件 / 决策 / 记忆 / 摘要接只读工具。（已落地基础版，chat 格式启用）
6. 故事模型接入 streaming tool calls：写正文前可按需读取司书库 / 大纲 / 开局 / 回合卷宗；工具调用结果不混入正文，前端显示“阅读了 / 查阅了 …”。（已落地基础版）
7. 给记忆 / 设定守护者接候选写入工具。
8. 引入司书模型做低频整理。
9. 再考虑部分自动写入。

## 当前接入状态

只读工具已接入 OpenAI/DeepSeek 兼容的 `chat/completions` 格式。`responses` 格式暂不启用工具，只保留原始调用。

已接入工具调用的模型：

- 回合司辰；
- 阶段判断员；
- 设定守护者；
- 叙事导演；
- 动态长线事件导演；
- 逻辑审校员；
- 决策 / 状态追踪模型；
- 记忆模型；
- 摘要模型。

故事模型当前已解析 `chat/completions` 的 streaming tool calls；它会收到【司书库文件结构】manifest，并可在正文生成前调用只读工具查资料。工具调用期间前端展示为独立的小标签（如“查阅了完整故事大纲”“阅读了 director/opening.md”），不会和正文混在一起。

每次模型读取司书库前，会用当前旅程状态刷新 `updatedBy=seed` 的系统镜像文件；玩家手动编辑的文件不会被自动覆盖。

补强说明：

- 系统镜像现在会补齐开局文本、详细大纲、自定义规则、当前导演计划、设定守护、逻辑审校和长线事件文件。
- 辅助模型遇到“回忆被跳过的开局关键事件 / 复盘大纲因果”时，应优先调用 `get_story_briefing`，必要时再读具体文件全文。
