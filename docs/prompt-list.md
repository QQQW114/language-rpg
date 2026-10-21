# 当前提示词清单（Prompt Pack v2.2）

当前 V2 提示词全部内嵌在 `src/v2/engine.ts`，没有独立的 `src/prompts/` 目录。三阶段分工：

```text
planner_pre（写前规划）→ story（写正文）→ planner_post（写后结算）→ 程序提交
```

Prompt Pack v2.2 的设计原则：**规划只定「结果底线 + 戏剧切面」，故事模型独占场景、台词与详略调度**；三阶段 JSON 契约、程序权威状态与前缀缓存结构不变。

### v2.2（gemini-4-argon 复审后，2026-10-21）

- 叙事速度四档改为**纯镜头焦距/剪辑节奏**文案；新增 `【STORY_AUTONOMY】` 三档（严格遵循 / 标准推进 / 自由发散）正式文案，并接管 `beatsThisTurn` 数量上限（1 / 2 / 3）。
- story 去掉“把结果写透写扎实”的催写指令，禁止段末总结陈词；句式黑名单降级为通用文学原则（反浓妆副词、反“不是A而是抽象B”、反慢镜头套话）。
- 按 story 模型自动解析文风 profile：`compact`（保留正反微示范、800~1200 字、完整锚点）/ `expressive`（省略微示范、900~1300 字、38 字短锚点）。
- planner_pre 增加“已演过的包袱/台词/已确认信息不得复读”规则；planner_post 增加 evidenceQuote 等字符串内引号必须改中文引号的约束。
- story 正文截断防护升级：<120 字或句尾缺少终结标点即判本回合失败、不提交；疑似供应商错误文本（内容审核/密钥/限额等）同样拒绝提交。

## 三个阶段的提示词函数

| 模型 | 阶段 | 提示词构造 | 说明 |
|---|---|---|---|
| 规划模型 | 写前规划 | `buildPlannerPreSystem(director)` | 输出本回合写作约束 JSON；`beatsThisTurn` 只写必须在本轮落地的客观结果，`writingBrief` 只写处境/隐秘顾虑/戏剧张力，`stopBoundary` 是节拍兑现后的交互悬置切面 |
| 故事模型 | 正文写作 | `buildStorySystem(director, profile)` | 只输出中文小说正文；含场景纵深准则、泛化声线矩阵；`compact` 额外带正反微示范，`expressive` 不带 |
| 规划模型 | 写后结算 | `buildPlannerPostSystem(director)` | 输出增量状态 Patch JSON；`satisfied` 按叙事功能实质兑现判定，已走完功能的 active 节拍需结案 |

## 消息拼装与缓存分区

```text
planner_pre：system（固定） + user#1【STABLE_STORY_CONTEXT】（固定）
             + user#2（固定输出模板 + 三幕窗口 + 动态世界书 + 节奏纠偏 + 权威状态 + 当前输入 + 叙事节奏 + 随机事件）
story：      system（固定） + user#1【STABLE_STORY_CONTEXT】（固定）
             + user#2【NARRATIVE_PACE】…【writingBrief/hardConstraints/creativeSpace/
               forbiddenChanges/STOP_BOUNDARY】【AUTHORITATIVE_STATE】【CURRENT_TURN_INPUT】
               + 【WRITING_EXECUTION_ANCHOR】（尾部近因锚点）
planner_post：system（固定） + user（固定输出模板 + 权威状态 + 输入 + 规划 + 停笔边界 + 正文）
```

- 前缀缓存硬约束：`system` 与 `user#1` 逐字节稳定；story 的 `user#2` 必须以 `【NARRATIVE_PACE】` 开头（有测试断言）；所有可变内容只出现在 user#2 内。
- story user#2 **不注入** `currentAct / activeBeatIds / destinyProgress / pathChange / reframingNeeded / reconvergencePlan / nextStoryFunction` 等工程元字段（v2 起删除）。

## 共享片段与注入块

| 片段 | 作用 |
|---|---|
| `plannerPrePlayerAgency` / `plannerPreDirectorAgency` | 写前规划对玩家输入视角的处理 |
| `storyPlayerAgency` / `storyDirectorAgency` | 故事模型对玩家输入视角的处理 |
| `plannerPostDirectorAgency` | 写后结算在导演视角下的额外约束 |
| `plannerToolDiscipline` / `plannerContextTool` | `search_story_context` 上下文检索工具与纪律 |
| `plannerWebSearchDiscipline` / `plannerWebSearchTool` | `web_search` 官方联网搜索（默认关、仅官方端点） |
| `writingExecutionAnchor` | story 用户消息末尾的近因锚点（compact 完整版 / expressive 38 字短版） |
| `postShape` | 写后结算输出 JSON 模板 |
| `paceInstruction(p)` / `randomEventInstruction(p)` | 叙事速度说明 / 随机事件三档指令 |

每回合按需注入：`【STAGE_AND_ACT_WINDOW】`（≤900 字三幕窗口）、`【DYNAMIC_WORLD_FACTS】`（关键词命中的世界书条目）、`【beatsThisTurn】`（≤3 条，慢叙事 1 条）、`【PACE_CORRECTION_ALERT】`（上一回合越界时的软纠偏）、`【RANDOM_EVENT_CONTEXT】` / `【RANDOM_EVENT_PLAN】`（到期随机事件）。

## 高优先级注入

- 配置：`AppSettings.roleInjects.planner / story / post`；
- 函数：`withRoleInject(baseSystem, inject)`，拼接在对应系统提示词最前方；
- 规划角色每个存档只注入一次（`state.plannerInjectApplied` 标记）。

## 输入视角

- 配置：`AppSettings.inputPerspective = 'player' | 'director'`；
- 只在执笔模式（`mode === 'author'`）下生效；
- 通过 `director` 参数传入上述 `build*System` 函数。

## 修改提示词时的同步清单

1. `src/v2/engine.ts` 的 `build*System` / `postShape` / user#2 拼装；
2. `src/v2/actWindow.ts`（三幕窗口 / 世界书拆分 / 节拍裁剪）；
3. `src/v2/randomEvents.ts`（事件绑定 / 历史 / 指令）；
4. `src/v2/paceGuard.ts`（节奏审计 / 纠偏文本）；
5. `src/v2/contextSearch.ts` / `src/v2/webSearch.ts`（工具返回结构）；
6. 测试：`tests/engine.test.ts`（请求形状与注入断言）、`tests/e2e`（43 条断言）、`tests/paceGuard.test.ts` 等。

## 模型分级建议

- 日常 / 轻量档：三阶段都用 `deepseek-flash` + Prompt Pack v2.1（当前生产基线）；
- 高优品质档：只把 story 阶段切到 `deepseek-v4-pro`，planner_pre / planner_post 继续用 flash（v2.1 下规划与结算准确率已足够，且显著节省成本与首字延迟）。
