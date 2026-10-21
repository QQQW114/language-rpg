# 当前提示词清单（Prompt Pack v2.2.1）

当前 V2 提示词全部内嵌在 `src/v2/engine.ts`，没有独立的 `src/prompts/` 目录。三阶段分工：

```text
planner_pre（写前规划）→ story（写正文）→ planner_post（写后结算）→ 程序提交
```

Prompt Pack v2.2.1 的设计原则：**规划只定「结果底线 + 戏剧切面」，故事模型独占场景、台词与详略调度**；单回合篇幅与展开幅度的唯一事实来源是 `【STORY_AUTONOMY】`，文风 profile 只控制笔法密度与近因锚点长短；三阶段 JSON 契约、程序权威状态与前缀缓存结构不变。

### v2.2（gemini-4-argon 复审后，2026-10-21）

- 叙事速度四档改为**纯镜头焦距/剪辑节奏**文案；新增 `【STORY_AUTONOMY】` 三档（严格遵循 / 标准推进 / 自由发散）正式文案，并接管 `beatsThisTurn` 数量上限（1 / 2 / 3）。
- story 去掉“把结果写透写扎实”的催写指令，禁止段末总结陈词；句式黑名单降级为通用文学原则（反浓妆副词、反“不是A而是抽象B”、反慢镜头套话）。
- 按 story 模型自动解析文风 profile：`compact`（保留正反微示范 + 完整锚点）/ `expressive`（省略微示范 + 38 字短锚点）。数值篇幅带已在 v2.2.1 收口（见下节）。
- planner_pre 增加“已演过的包袱/台词/已确认信息不得复读”规则；planner_post 增加 evidenceQuote 等字符串内引号必须改中文引号的约束。
- story 正文截断防护升级：<120 字或句尾缺少终结标点即判本回合失败、不提交；疑似供应商错误文本（内容审核/密钥/限额等）同样拒绝提交。

### v2.2.1（篇幅带单一来源，2026-10-21）

- **单一来源**：单回合篇幅与展开幅度只由 `【STORY_AUTONOMY】` 三档给出——strict 400~800 字 / standard 800~1200 字 / free 1000~1500 字，并接管 `beatsThisTurn` 数量上限（0~1 / 1~2 / 1~3）。文风 profile 只控制**笔法密度**（`compact` 带正反微示范、`expressive` 不带）与**近因锚点长短**（完整版 / 38 字短版），不再携带数值篇幅带。
- **收掉的三处第二套数字**：
  1. story system 删除 profile 的篇幅带，改为「目标篇幅以`【STORY_AUTONOMY】`为准」，并新增明文优先级——profile / 近因锚点 / 叙事速度与 `【STORY_AUTONOMY】` 的篇幅目标冲突时，以后者为准；
  2. planner_pre `stopBoundary` 不再说「轮数与篇幅由 STORY_AUTONOMY 与 NARRATIVE_PACE 共同决定」，改为「单回合的交锋轮数与篇幅以`【STORY_AUTONOMY】`为准，叙事速度只调整镜头焦距与时间流速」；
  3. story 正文「通过 2~3 个来回的当场对手戏」与 compact 近因锚点「充分展开 2~3 轮」中的硬编码轮数删除，展开幅度统一回指 `【STORY_AUTONOMY】`。
- 叙事速度四档自此只负责镜头焦距与时间流速，不提供第二套篇幅目标；三阶段 JSON 契约、程序权威状态与前缀缓存结构不变。
- 验证：`tests/engine.test.ts` 新增单一来源回归断言——story system 中不得出现 `\d+~\d+字` 形式的数值篇幅带、数值带只允许出现在 `【STORY_AUTONOMY】`（story user）里、planner_pre system 同样不得写死篇幅。T4 真实链路（2026-10-21）：strict / standard / free 均值 **638 / 1126 / 1477** 字、单调分离；deepseek 20 回合 p50 **1275** / max 2002；gemini 20 回合 20/20、p50 **1421** / max 1786、19/19 随机事件 resolved（固定输入/单次采样/反代无缓存；详见 `docs/prompt-design-log.md` §7.5 与复审包 07）。

## 三个阶段的提示词函数

| 模型 | 阶段 | 提示词构造 | 说明 |
|---|---|---|---|
| 规划模型 | 写前规划 | `buildPlannerPreSystem(director)` | 输出本回合写作约束 JSON；`beatsThisTurn` 只写必须在本轮落地的客观结果，`writingBrief` 只写处境/隐秘顾虑/戏剧张力，`stopBoundary` 是节拍兑现后的交互悬置切面 |
| 故事模型 | 正文写作 | `buildStorySystem(director, profile)` | 只输出中文小说正文；含场景纵深准则、泛化声线矩阵；`compact` 额外带正反微示范，`expressive` 不带；profile **不携带数值篇幅带**，篇幅以 `【STORY_AUTONOMY】` 为准 |
| 规划模型 | 写后结算 | `buildPlannerPostSystem(director)` | 输出增量状态 Patch JSON；`satisfied` 按叙事功能实质兑现判定，已走完功能的 active 节拍需结案 |

## 消息拼装与缓存分区

```text
planner_pre：system（固定） + user#1【STABLE_STORY_CONTEXT】（固定）
             + user#2（固定输出模板 + 三幕窗口 + 动态世界书 + 节奏纠偏 + 权威状态 + 当前输入
               + 叙事节奏 + 推进权限【STORY_AUTONOMY】 + 随机事件）
story：      system（固定，篇幅指引指向【STORY_AUTONOMY】） + user#1【STABLE_STORY_CONTEXT】（固定）
             + user#2【NARRATIVE_PACE】【STORY_AUTONOMY】…【writingBrief/hardConstraints/creativeSpace/
               forbiddenChanges/STOP_BOUNDARY】【AUTHORITATIVE_STATE】【CURRENT_TURN_INPUT】
               + 【WRITING_EXECUTION_ANCHOR】（尾部近因锚点；不写死轮数）
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
| `writingExecutionAnchor` | story 用户消息末尾的近因锚点（compact 完整版 / expressive 38 字短版；不写死展开轮数，展开幅度回指 `【STORY_AUTONOMY】`） |
| `storyAutonomyInstruction(p)` | 生成 `【STORY_AUTONOMY】` 三档推进权限文案；**篇幅与展开幅度的唯一来源**，planner_pre 与 story 共用同一份文本 |
| `postShape` | 写后结算输出 JSON 模板 |
| `paceInstruction(p)` / `randomEventInstruction(p)` | 叙事速度说明 / 随机事件三档指令 |

每回合按需注入：`【STAGE_AND_ACT_WINDOW】`（≤900 字三幕窗口）、`【DYNAMIC_WORLD_FACTS】`（关键词命中的世界书条目）、`【beatsThisTurn】`（程序按推进权限裁剪：strict ≤1 / standard ≤2 / free ≤3 条；叙事速度不参与节拍数量）、`【PACE_CORRECTION_ALERT】`（上一回合越界时的软纠偏）、`【RANDOM_EVENT_CONTEXT】` / `【RANDOM_EVENT_PLAN】`（到期随机事件）。

## 高优先级注入

- 配置：`AppSettings.roleInjects.planner / story / post`；
- 函数：`withRoleInject(baseSystem, inject)`，拼接在对应系统提示词最前方；
- 规划角色每个存档只注入一次（`state.plannerInjectApplied` 标记）。

## 输入视角

- 配置：`AppSettings.inputPerspective = 'player' | 'director'`；
- 只在执笔模式（`mode === 'author'`）下生效；
- 通过 `director` 参数传入上述 `build*System` 函数。

## 连接配置与阶段级重试（T2/T3 工程增强）

### 混合端点（story 阶段独立连接）

- 设置：`AppSettings.storyApiBaseUrl` / `storyApiKey`（均可选）；**留空 = 分别继承**全局 `apiBaseUrl` / `apiKey`，可以只覆盖 base 或 key 其中一个。
- 路由：planner_pre / planner_post / 结算与「仅重试结算」始终用全局连接；只有 story 用独立连接。联网搜索、规划 JSON 模式与规划思考强度仍只按全局端点判定；`reasoning_effort` 按各阶段实际端点决定是否发送（story 走非官方反代时不发它不认识的字段）。
- 兼容：默认两个字段为空串（旧设置 normalize 后也是空串），行为与单端点时完全一致；独立 Key 只存浏览器本地，不回显 / 日志 / 活动流 / 导出报告。
- 典型用法：规划与结算走官方 DeepSeek（前缀缓存与 JSON 稳定），story 走 Gemini 等更强的模型或反向代理。
- 真实冒烟（T2b，2026-10-21）：planner/post deepseek-flash + story gemini-3.8-flash-high 独立 base，3/3 回合、9/9 请求 200（planner base 6 / story base 3），story 确实走独立模型；planner 缓存保留（pre 31.9% / post 28.3%）、story 0%（反代无缓存）。详见 `test-runs/v22-validation.md` §11 与复审包 07 H 组。

### story 阶段级自动重试

- 触发条件：story 流式截断（过短 / 句尾缺终结标点）、供应商错误文本、`finish_reason=length|content_filter`、网络 / 429 / 5xx 等瞬时错误。
- 次数与复用：最多 **2 次尝试**（首次 + 1 次重试）；重试复用同一份 `storyParams`（brief、三幕窗口、动态世界书、随机事件计划、`beatsThisTurn`、节奏纠偏、`commitId` 与完整提示词），**不重跑 planner_pre、不重抽随机事件**——因此两次尝试的提示词与缓存前缀逐字节一致。
- 可观察信号：`phase_restart` activity（`attempt` / `maxAttempts` / `reason`）与 `story_stream_restarted` warning；游戏页收到后清空失败尝试的流式正文与 story 思考，不会拼出两段正文。
- 不重试：用户取消 / 超时 / 认证错误；失败尝试不写入 `turnRecord`，最终失败仍抛原始错误，由整回合重试兜底。

## 修改提示词时的同步清单

1. `src/v2/engine.ts` 的 `build*System` / `postShape` / user#2 拼装；
2. `src/v2/actWindow.ts`（三幕窗口 / 世界书拆分 / 节拍裁剪）；
3. `src/v2/randomEvents.ts`（事件绑定 / 历史 / 指令）；
4. `src/v2/paceGuard.ts`（节奏审计 / 纠偏文本）；
5. `src/v2/contextSearch.ts` / `src/v2/webSearch.ts`（工具返回结构）；
6. 测试：`tests/engine.test.ts`（请求形状与注入断言，含 v2.2.1 篇幅单一来源回归）、`scripts/e2e-mock-flow.mjs`（44 条断言）、`tests/paceGuard.test.ts` 等。

## 模型分级建议

- 日常 / 轻量档：三阶段都用 `deepseek-flash` + Prompt Pack v2.2.1（当前生产基线；v2.1 实测单回合约 1,100~1,200 字，v2.2.1 篇幅随 `【STORY_AUTONOMY】` 三档浮动）；
- 高优品质档：只把 story 阶段切到 `deepseek-v4-pro`，planner_pre / planner_post 继续用 flash（v2.1/v2.2 下规划与结算准确率已足够，且显著节省成本与首字延迟）。
