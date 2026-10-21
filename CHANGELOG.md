# 更新记录

本项目从 v0.3.0 起使用语义化版本号。早期测试标签保留原名，不再作为后续标签命名规范。

## [未发布]

### 新增

- **故事推进权限骨架（与叙事速度解耦）**：新增 `GameStateV2.storyAutonomy`（`strict` 严格遵循 / `standard` 标准推进 / `free` 自由发散，缺省 `standard`，旧存档 hydrate 自动补默认值）。游戏页「自由行动」区新增三档切换，逐回合注入 `【STORY_AUTONOMY】` 到 planner_pre 与 story 的可变区；叙事速度（慢/标准/快/时间跨越）暂时保留原有语义，后续按外部评审拆分为纯写作风格。
- 规划/写作提示词对推进权限的精细措辞、以及叙事速度的职责收窄，列入下一轮提示词评审；本次只落状态、UI 与注入骨架。

### 测试

- 单元测试 562 → **564 条**：新增推进权限三档注入、缺省值、叙事节奏前缀顺序 2 条；fixtures 补 `storyAutonomy` 以保持导入导出往返一致。

## [0.5.2] - 2026-10-20

### 新增

- **故事推荐出身（`StoryOutline.backgroundIds`）**：故事可以声明自己的推荐主角出身；启程页选择故事后只展示这些出身，并在切换故事时自动选中第一个推荐出身；未声明的自定义故事仍展示全部出身（旧行为不变）。
- **补全两个预设主角出身**：导入《余温代行人》的林澈（旧港维修学徒）与《赝品修复师》的苏砚（古玩斋替工），并分别绑定到对应故事的 `backgroundIds`；三个内置故事现在各有自己的开局主角出身（曦宇 / 林澈 / 苏砚）。
- `contentLibrary.validateStoryOutline` 保留并清洗 `backgroundIds`；`tests/presets.test.ts` 增加出身引用与内置主角断言。

### 修复

- 0.5.1 只导入了 Gemini 包里的两个故事与世界书、漏掉了两个主角出身，导致启程页缺少这两个预设角色；本次补齐并改为按故事过滤，避免把故事专属主角暴露给其它故事。

### 测试

- 单元测试 560 → **562 条**（20 个测试文件）：`presets` 增加「推荐出身可解析」「内置主角出身已导入」两条。

### 说明

- 无需存档迁移：存档只保存创建时的大纲/出身副本；新预设与推荐出身只影响新旅程。
- 内容示例与格式说明同步更新（`docs/preset-authoring.md`、`docs/content-examples/README.md`）。

## [0.5.1] - 2026-10-20

### 新增

- **内置预设故事 1 → 3**：导入外部模型生成、经 `validateImportBundle` 校验的《余温代行人》（近未来市井科幻）与《赝品修复师》（都市古玩悬疑），各 5 幕 15 节，并附带两本配套世界书（各 7 个条目）；内置预设列表见 `src/presets/outlines.ts` / `src/presets/worldbooks.ts`。新增 `tests/presets.test.ts`（5 条）固定校验必填字段、id 唯一、世界书引用可解析与结构数量。
- **内容示例归档**：`docs/content-examples/` 收录《错位青春》大纲/世界书/出身示例与本次 Gemini 生成的原始 `ImportBundle`，供后续批量生成参考。

### 文档

- 新增 `docs/prompt-design-log.md`：四轮外部评审的结论、v2/v2.1 改动、A/B 数据、过拟合审计（哪些规则是通用原则、哪些是 `deepseek-flash` 专病）与模型分级建议。
- 新增 `docs/preset-authoring.md`：预设故事/世界书/出身的编写规范、导入包格式、内置预设表与外部批量生成提示。
- 清理 `docs/temp/` 下的临时评审记录、反馈文本与已集成的前端交接文件；`docs/README.md` 导航同步。
- `docs/PROJECT_STATUS.md`：测试体系更新为 560 条 / 20 文件。
- 新增 `docs/release-notes-v0.5.1.md`。

### 说明

- 本次导入的两个故事是**全局内容更新**，不需要存档迁移；旧存档仍使用创建时 own 的大纲副本，不会受影响。
- Gemini 包里的两个出身是故事专属主角（林澈 / 苏砚），出身选择是全局的，未导入，避免与其它故事错配；原始包保留在 `docs/content-examples/`。

## [0.5.0] - 2026-10-20

> 本版主线：程序权威幕系统（P1–P5）、长文阅读前端、上下文检索与可选联网搜索、双模型提示词重构（Prompt Pack v2.1）。

### 新增

- **Prompt Pack v2 → v2.1（双模型分工校准，本版核心）**：把「规划写分镜、故事做扩写」改为「规划定结果底线与戏剧切面、故事独占场景与台词」。
  - `planner_pre`：`beatsThisTurn` 只写必须在本轮落地的客观结果（供写后核验）；`writingBrief` 只写场景处境、彼此隐秘顾虑与戏剧张力，禁止代写台词/微动作；`stopBoundary` 改为「节拍兑现后的交互悬置切面」，并要求单回合包含 2–3 轮实质交锋（自然 800–1200 字）；跨日输入自动作废前一日限时事务。
  - `story`：重写为「叙事质感与场景纵深准则」——状态标签不得当人名、初见临时指代在正式互动/签名时必须换成真名、已确立日常流程 1 句话带过、动作必须推动交锋、禁止慢镜头/心理说明书/盯视计时器；泛化人物声线（按角色功能而非姓名）与 2 组「坏→好」微示范；黑名单内联收敛，避免对单一模型的过拟合。
  - `story` 的 user 消息删除 `currentAct/activeBeatIds/destinyProgress/pathChange/reframingNeeded/reconvergencePlan/nextStoryFunction` 7 个工程元字段，末尾追加近因锚点（v2.1 已压缩为一句 68 字，回收思考 token）。
  - `planner_post`：`satisfied` 允许通过具体事件/行动结果/自然对话实质兑现叙事功能（不要求字面复述标题）；已实质走完的 active 节拍应及时结案，跨日时限事务同步关闭；人物 `name` 必须取真名或固定昵称，禁止把「抱书女生」这类临时描述固化为跨场景人名。
  - 真实 A/B（同一批 20 条输入、deepseek-flash）：状态标签当人名 48→0、`【stopBoundary】` 泄漏 1→0、慢镜头/秒表词 14→1、盯视计时器 4→0；v2.1 十五回合验证中位字数回到 1193（v2 为 724，短回合 6→0）、T11 进入第三幕、T15 `satisfied=8`、输出 token 总量与 v2 持平但正文多 58%（每字输出 token 下降约 39%）。
  - 模型分级建议：日常/轻量档固定 `v2.1 + deepseek-flash`；高优品质档可仅把 story 阶段切到 `deepseek-v4-pro`，planner_pre / planner_post 继续用 flash。
- **回合续跑（失败恢复）**：写后结算（`planner_post`）失败时不再整轮作废。`runTurnV2` 抛携带中间结果的 `TurnPostFailureV2`（正文、写前简报、commitId、已完成的两阶段调用），新增 `runTurnSettlementV2()` 只重跑结算与提交；游戏页显示「正文已生成 · 结算未完成」，提供「仅重试结算」（只发一次结算请求）与「重新生成本回合」两个恢复操作。续跑带 revision/turn 前置校验，提交仍走原有两道 CAS。
- **存档导出/导入**：主页「继续旅程」可把存档导出为 JSON 备份（信封 `{kind:'lrpg-save',version:1,exportedAt,save}`，与持久化共用裁剪规则、剔除提示词留档），也可从备份导入恢复。导入一律生成新 id 作为新旅程、不覆盖现有存档，名称冲突自动加「（导入）」；版本过高的信封/存档与畸形 JSON 会被拒绝并给出可读原因；复用 hydrate 规范化，缺字段旧档也能导入。
- **路由级动态分包**：`/game`、`/setup`、`/workshop`、`/settings` 改为按需加载，并把 React 与 Markdown 依赖拆成稳定 vendor chunk——主入口从 548.51 kB 降到 42.57 kB（gzip 181.17 kB → 16.03 kB），500 kB chunk 警告消失。
- **程序权威幕状态机**：`destiny.currentActId` 不再由模型自报——模型提交的当前幕与程序权威不一致（未知幕、跳幕、倒退）一律忽略并按 `act_current_id_rejected` 写活动流警告，幕推进只由故事节完成情况决定。常规轨：本幕原生故事节全部 `satisfied`/`superseded` 时自动进入下一幕。改道轨：结算模型显式提议 `destiny.actTransition.proposeNextAct`，程序按三道 gate 判定（终态 ≥1 条且占比 ≥50%；非终态节全部为 `reframed`/`weakened` 且写明 `currentPlan`；非终态 ≤2 条），通过后携节挂账进入下一幕。`actId` 永不变更，挂账节用 `carriedFromActId` 标记来源且不视为完成——结局门槛不放宽；新增 `currentActIndex` / `actHistory`（`enteredTurn` / `exitedTurn` / `exitSummary` / `carriedBeatIds`）/ `lastActTransitionTurn`。`SAVE_STORAGE_VERSION` 1 → 2：旧档 hydrate 时按大纲反查补齐 `beats[].actId`、纠正自由文本 `currentActId`、补空 `actHistory`，不伪造历史。
- **工坊幕级可选字段**：故事幕新增 `entryBrief`（开幕引子，≤200 字）/ `stageContract`（写作契约与禁令，≤200 字）/ `exitCriteriaNote`（幕完成叙事标志，≤120 字），编辑器、内容库校验、保存与 JSON 导入导出全链路支持；留空时退化为「只用 purpose + 通用过渡指令」。工坊保存对契约中的强线性词给非阻断警告。运行时 `entryBrief` 只在切幕后 1~2 回合注入，`exitCriteriaNote` 作为阶段完成标志全程保留。
- **三幕窗口与本轮节拍**：新增 `【STAGE_AND_ACT_WINDOW】` 可变区注入（上一幕只读因果基线 / 当前幕施工契约 / 下一幕只许埋伏笔 / 最终命运锚 / 阶段红线），总长 ≤900 字，超预算按 6 级降级；规划输出新增 `beatsThisTurn`，程序裁成 1~3 条（慢叙事只留第 1 条）作为本轮唯一节拍清单。世界书拆成稳定/动态两块：`alwaysActive` 条目进逐字节稳定的 `【STABLE_STORY_CONTEXT】`，关键词命中条目改走 `【DYNAMIC_WORLD_FACTS】`，修掉稳定上下文随玩家输入变化导致前缀缓存失效的隐患。
- **随机事件 D7（目的绑定 + 滚动钩子 + 三态 + 智能强度）**：写前规划安排事件时必须给出 `targetKind`（beat/thread/relationship/reconvergence）、`targetId`（只能取自程序提供的候选目标）与 `summary`（≤80 字），无绑定或越界绑定只记 `lastPlan` 并留警告；新增滚动 `history`（上限 8，裁剪时优先保留最近 3 条 `ongoing_hook`）。结算三态 `resolved` / `ongoing_hook` / `interrupted`（interrupted 保留绑定并把调度顺延到下一回合）。强度改由程序按「改道/挂账 → destiny、刚切幕或节拍停滞 → progress、否则 related」智能选择；切幕回合若下次事件排在两回合之后，自动拉近并升为推进/命运档。
- **节奏审计与下轮软纠偏**：新增 `src/v2/paceGuard.ts`，对每回合正文做确定性检测——尾 220 字五类升华/收束模式、时间推进词计数、慢/标准叙事 >5000 字，结果写入 `TurnRecordV2.pacing`。只观察、不回滚也不改写正文；上一轮越界时，下一轮 planner_pre 与 story 注入 `【PACE_CORRECTION_ALERT】`（≤220 字），要求只推进 1 个节拍、到点停笔。检测刻意保守：只检查剔除对白后的叙述尾段，时间词阈值 3，快叙事/时间跨越不判篇幅。
- **长文前端精修（Gemini 方案集成）**：新增 `src/v2/ReadingNavigator.tsx`——顶栏阅读导航、卷宗目录抽屉与回合跳转、存档级回合书签（`lrpg.bookmarks.<saveId>`）、字号/行距/版心偏好（`lrpg.reader.prefs`）、右下角「回到最新」罗盘，以及切幕时的「卷首题跋」与「前卷回响 · 幕间纪要」。`ModelActivityPanel.tsx` 从 GamePage 抽出并升级为「司辰仪」控制台（三阶段活动、思考链复制、工具与警告、token/缓存命中、`patchStats` 对账）。`UpdateGlow` 升级为五层金线编排（SVG 双轨描边 + 四角星铆、副刃残影、七曜星芒、金尘）；路由切换补「延伸金线」。
- **预设《错位青春》5 幕改造**：由 3 幕 16 节改为 5 幕 15 节（拆出「第四幕 · 故人重逢与错位试探」与「第五幕 · 真相与共生日常」），并补齐每幕 `entryBrief` / `stageContract` / `exitCriteriaNote`；世界书的幕序引用同步。旧存档持有自己的 outline 副本，不受预设改造影响。
- **上下文检索工具重构**：`search_story_context` 的分词、候选构建、证据切片与排序下沉到 `src/v2/contextSearch.ts`（纯函数，engine 净删约 172 行；工具名与参数 schema 不变）。查询改为 CJK 整段 + bigram 展开（单字人名也可查）、停用词过滤、全角转半角、最多 12 个检索词；证据默认 900 → **500 字**，命中点落在截断点之后时以命中位置为中心切片；排序改为「整串命中 +100 → 覆盖率 ×60 → 逐词长度小权重」，取消 facts / 非 history 的 magic 加权（已知问题 N）；同一来源最多 2 条、按来源 / 标签 / 证据去重并截到 limit；返回保持 `query/scope/resultCount/results/note` 兼容，新增 `matchedTerms/score`，0 结果时给出更具体的下一步提示。
- **规划模型可选联网搜索（默认关）**：新增 `src/v2/webSearch.ts`，封装 DeepSeek 官方 `POST {apiBase}/tools/search`。设置新增 `plannerWebSearchEnabled`（默认 false）；只有「工具开启 + 联网开关 + 官方 DeepSeek 地址 + 有 API Key」同时满足时，planner_pre 才挂载 `web_search` 并注入工具纪律——每回合最多 1 次，故事 / 结算阶段恒无工具。请求支持 `ori_question`（玩家原始输入，≤128 字）与 `need_content:false`，返回条数夹 1~5；响应按 `rerank_score` 降序、过滤坏数据与超量结果并截断，**低置信度回退**（没有 ≥1.5 的高分结果时退到 ≥0.5 并标 `lowConfidence`）；429 / 5xx / 网络错误 / 超时 / 坏 JSON 全部降级为工具错误文本，绝不抛异常打掉回合。设置页「上下文与工具」新增开关与说明（默认关、仅官方 DeepSeek 生效、计费约 `$0.75/1000` 成功请求（≈¥5.4）、查询内容会发给 DeepSeek、外部结果不得覆盖世界书与正史）。
- **真实链路冒烟支持长局评测与分阶段缓存统计**：`scripts/real-chain-smoke.mjs` 新增 `LRPG_INPUTS_FILE`（外部输入列表）、`LRPG_TOOLS=1`（上下文检索工具）、`LRPG_WEB_SEARCH=1`（联网搜索）、`LRPG_TURNS` 上限从 5 扩到 40、`LRPG_MAX_TOKENS=0` 表示不限输出；回合记录新增三阶段 usage / 缓存命中，报告新增 `cacheSummary`（不含首回合冷启动的命中率）与 `evaluation`（篇幅 min/p50/p90/max、升华收尾 / 时间跳跃 / 超预算 / 纠偏触发、随机事件三态、幕切换次数、token 合计）。

### 修复

- **节奏审计把台词/计划性时间词误判为跨日推进**：20 回合真实长局里，角色台词与心理回忆中的「明天中午」「后天晚上」「下午」被 `paceGuard` 当成正文实际跨日，导致 T4/T7/T12/T13 触发软纠偏。现在统计前先剔除成对引号内台词，并忽略「今天/明天/昨天/上周… + 时段词」这类日期指向组合；真正的跨日词（第二天/次日/几天后…）仍然计数。回归测试 `tests/paceGuard.test.ts`。
- **hydrate 静默丢失随机事件审计字段**：`sanitizeGameStateV2` 重建 `randomEvent` 时漏了 spread，`lastPlan` / `lastNote` / `lastTriggeredTurn` 在每次刷新页面（以及导入存档）后被丢弃；游戏页「故事脉动」卡片的安排与结果因此消失。现在保留这三个字段并补回归测试。
- **`turnRecords[].calls` 缺失时写盘/导出抛错**：手改或导入的存档若某个回合记录缺 `calls`，持久化与导出都会抛异常。sanitize 现在把 `calls` 归一化为数组，裁剪函数再加一层防御。
- **侧边栏更新特效被提前清空、部分块从不播放**：GamePage 的变更列表定时器在 1600ms 就清空，而强化后的五层动画完整时长约 2450ms，星芒与金尘每次都被截断；同时 `scene` / `progress` / `fact` / `item` / `thread` / `randomEvent` 等块漏传 `change`，数据变了却不播特效。现在清空定时器与动画时长对齐，所有可更新块都接到同一份变更列表。
- **切幕后 `currentStage` 空白**：幕状态机的 `advanceAct` 旧实现直接清空阶段文本，切幕后 1~2 回合命运卡与幕窗口没有阶段描述（20 回合真实长局里 T5/T6/T12 复现）。现在写入程序侧兜底「本幕开篇」，等模型下一轮写出具体阶段后覆盖；回归测试 `tests/patch.test.ts`。

### 变更

- 单元测试运行器按 `--filter` 隔离产物与报告目录（`test-runs/unit/<scope>/`），支持多个 agent 并行跑不同过滤条件的测试。
- **提示词可变区重排**：planner_pre 的固定输出模板之后依次注入三幕窗口、动态世界书与节奏纠偏，再接 `【AUTHORITATIVE_STATE】`；story 的用户消息仍以 `【NARRATIVE_PACE】` 开头（前缀缓存回归断言依赖该结构），三幕窗口与 `beatsThisTurn` 排在叙事节奏之后。

### 测试

- 单元测试 304 → **338 条**（15 个测试文件）：新增结算失败续跑 7 条、存档导出/导入 21 条、store 导入与 hydrate 加固 6 条。
- **单元测试 338 → 479 条（18 个测试文件）**：新增 `actWindow` / `randomEvent` / `paceGuard` 三个测试文件，覆盖窗口降级与稳定块字节不变、`beatsThisTurn` 裁剪、事件历史裁剪与绑定校验、三态闭环与智能强度、切幕平滑、节奏审计与纠偏文本；`patch` 补幕状态机全部 gate 分支，`store` 补旧档幕迁移。
- 新增 `npm run test:real`（`scripts/real-chain-smoke.mjs`）：用真实 engine 打真实 OpenAI 兼容端点跑真实回合（默认 2 回合，可指定 1~40），内置请求级重试；需 `LRPG_API_BASE` / `LRPG_API_KEY` / `LRPG_MODEL`，产物 `test-runs/real-chain-report.json`。
- **真实链路与缓存实测（2026-10-20）**：DeepSeek 官方 `deepseek-flash` 连跑 3 回合，第 2 回合起前缀缓存稳定命中，相邻回合命中 token 恒定（planner_pre 3,328 / story 3,200 / planner_post 1,536），预热回合命中率约 42.0% / 36.8% / 30.3%；同时验证随机事件真实闭环（`T2 resolved related→thread`）。数据与解读见 [`docs/cache-prefix-investigation.md`](docs/cache-prefix-investigation.md) 第九节。
- `npm run test:e2e` 43/43、`npm run test:patch`、`npm run test:storage`、`npm run test:story -- --dry-run` 全部通过。
- **单元测试 515 → 551 条（20 个测试文件）**：上下文检索重构带来 479 → 515（`tests/contextSearch.test.ts` 33 条 + `tests/engine.test.ts` 工具用例 3 条），联网搜索带来 515 → 551（`tests/webSearch.test.ts` 30 条 + engine 联网行为 6 条：默认无工具、开启 + 官方 + Key 挂载、非官方不挂载、结果注入且回合提交、同回合第二次被拒、搜索失败不失败回合）。
- `test:real` 真实链路：10 回合 10/10，web_search 被模型自发调用一次，官方端点直连返回 3 条并解析成功；20 回合长局 p50 1,135 字、升华收尾 0、自动切幕 2 次、随机事件 19 个全部绑定、缓存预热 pre 17.3% / story 22.0% / post 16.6%（数据与解读见 `docs/cache-prefix-investigation.md` 9.4）。
- **单元测试 551 → 555 条**（20 个测试文件）：`paceGuard` 新增 4 条，覆盖「引号内台词时间词不计数」「明天/后天/上周等计划性时段词不计数」「真正的叙事跨日仍然计数」「真实长局 T4/T12 误报样本不再触发」。
- **Prompt Pack v2 / v2.1 真实 A/B（同一批 20 条输入、deepseek-flash）**：v2 使状态标签当人名 48→0、`【stopBoundary】` 泄漏 1→0、慢镜头词 14→1、盯视计时器 4→0；v2.1 把中位字数从 724 拉回 1,193（<650 字回合 6→0），T11 切入第三幕，T15 `satisfied=8`、`active=0~1`；输出 token 与 v2 持平而正文多 58%（每字输出 token 约降 39%）。

### 文档

- `docs/known-issues.md`：补登记 hydrate 丢字段与 `calls` 加固的已修复条目，新增「续跑中间结果只存内存」待决策项；标注 L/M 检索问题已修。
- `docs/PROJECT_STATUS.md`：核心文件表补 `saveTransfer.ts` 与续跑 API，测试体系与用例数同步，已知边界更新。
- `README.md`、`AGENTS.md`：补存档备份/失败恢复说明与新模块位置。
- 合并 `[0.4.0]` 中重复的「新增」小节。
- 新增 `docs/story-framework-brief.md`（给外部模型的自包含评估简报）与 `docs/act-system-plan.md`（幕系统决议、数据模型增量、P1–P6 步骤与验收口径）；`docs/README.md` 同步收录。
- `README.md` / `AGENTS.md` / `docs/PROJECT_STATUS.md`：同步幕系统、随机事件绑定与钩子、节奏纠偏、阅读导航与新模块位置、测试体系数字。
- `docs/known-issues.md`：把 N（检索评分被 magic 加权压过）标记为已修，并在「已修复」一节补实现与取舍说明；`AGENTS.md` / `docs/PROJECT_STATUS.md` / `README.md`：同步 `contextSearch.ts` / `webSearch.ts`、规划工具行为矩阵、`plannerWebSearchEnabled` 设置与 `test:real` 的 `LRPG_*` 用法。
- `docs/cache-prefix-investigation.md`：新增 9.4「20 回合长局实测」，区分「短局看机制、长局看收益」的读法；`docs/act-system-plan.md`：P6 进度注补真实 20 回合长局已跑通，剩余可选 A/B 质量评估。
- `docs/prompt-list.md`：重写为 Prompt Pack v2.1 结构说明（三阶段职责、user 消息拼装、近因锚点、反 AI 味规则、泛化声线、工具纪律与节奏纠偏注入）。
- `docs/PROJECT_STATUS.md`：测试体系同步 555 条 / 20 文件，新增 Prompt Pack v2.1 与节奏审计修复说明。
- 新增 `docs/release-notes-v0.5.0.md`：本版发行说明与升级/模型分级建议。

## [0.4.0] - 2026-09-27

### 移除

- **整体移除 Responses（`/responses`）链路**：`apiFormat` 在界面上没有任何入口，该格式对用户是死代码，且其下 `thinkingMode` / `reasoningEffort` / `plannerJsonMode` / 工具开关全部静默失效。现在只支持 Chat Completions。usage 的 `input_tokens` / `output_tokens` / `*_tokens_details.cached_tokens` 别名归一化保留（属于通用供应商差异，不是 Responses 专属）。
- 清理 V1 遗留代码：删除 36 个被 git 跟踪的零引用文件（另有 1 个从未纳入 git 的 `src/pages/GamePage.tsx.bak`，共 37 个），包括旧页面（`LibraryPage`、`GamePage.tsx.bak`）、18 个旧组件、IndexedDB 司书库（`storage/ledgerRepository.ts`）、工作区/司书库模板链路、旧执笔链提示词与只服务旧类型的工具模块。
- 移除内容库中的随机事件条目与司书库模板：`RandomEvent` / `WorkspaceTemplate` 类型、预设事件库、以及 `contentLibrary` / `useContentStore` 中的对应分支。随机事件改由 `engine.ts` 指令与 `patch.ts` 调度独立驱动（行为不变）。
- 删除误导性的临时重构产物 `.tmp_cn_refs.txt` 与 `.tmp_item_refs.txt`。

### 新增

- **思考强度补上 `low` 档，并支持逐阶段设置**：DeepSeek 官方映射为 `minimal/low → low`、`medium/high/xhigh → high`、`max/ultra → max`，不提供数字型思考预算；原先只暴露 high/max，等于把思考预算锁在最贵两档。现在设置页可对写前规划 / 故事正文 / 写后结算分别选择「跟随全局 / Low / High / Max」，默认只给结算降一档（它的产出结构由模板固定，属机械性任务）。关闭思考时改为显式发送 `thinking: {type:'disabled'}`——官方文档说明思考模式**默认开启**，"什么都不发"会退回默认开启而不是关闭。
- **状态提交对账统计（`patchStats`）**：每回合记录"模型提交了多少条状态变更、程序接受了多少条、丢弃了多少条、改写了多少处枚举"，其中"结构不全"（模型漏填必填字段）与"字段齐全但被拒"（引用了不存在的 id）分开计数——两者的修法完全不同。数字写进 `TurnRecordV2.patchStats` 并随存档持久化，游戏页「模型活动」面板的写后结算阶段会显示一行对账结果。此前这些丢弃只以警告文本存在，既没有数字也无法累计观察，导致"模型以为记下了、程序其实丢了"这个结构性盲区一直无法度量。这一步是先量后改：只有确认丢弃比例可观，才值得把被拒情况回显给结算模型（见 [`docs/planner-multiround-evaluation.md`](docs/planner-multiround-evaluation.md)）。
- **侧边栏信息更新的视觉反馈**：侧边栏的块（人物、线程、命运、场景、进展、事实、背包）有更新时，一条与卡片边框同源的金色斜线自左向右扫过，掠过之处伴随几颗同色小星星原地转圈闪烁后淡出；原本不存在的块先用虚线描出轮廓再走同一套效果。判断"什么变了"是纯函数（`src/v2/sidePanelUpdates.ts`，含单测），表现层在 `src/components/ui/UpdateGlow.tsx`，动画与项目其余动效同在 `tailwind.config.js` 维护。覆盖层为 `pointer-events-none` 不吃点击，并尊重 `prefers-reduced-motion`。
- **未发送输入的草稿保留**：输入框内容按存档存入 `lrpg.draft.<saveId>`，打开设置页、返回主页或刷新后重新进入对话时仍在。刻意不写进 `lrpg.v2`——草稿是易失的界面状态，不该参与存档体积与写入可靠性机制。输入变化 250ms 防抖写入，`pagehide` 时补一次；每个存档只恢复一次，不覆盖玩家后续输入。
- **发送消息时自动滚动到底部**：文献卡内、输入框之前放零高度锚点，用 `scrollIntoView` 跟随（位置由浏览器按真实布局计算，不需要维护像素常量；锚点在输入框之前，所以滚到底时输入框自然贴住它）。玩家主动往上翻读时不打断，滚回底部或发送新行动后恢复跟随。
- **常驻 mock 供应商 `scripts/mock-provider.mjs`**：供浏览器手动冒烟用。按轮次稳定改变侧边栏内容（第 1 轮新增人物与线程、第 2 轮改人物状态并推进线程、第 3 轮新增道具与事实），一次点完即可观察四种更新特效。
- **自动化测试系统**：`npm test` 使用 esbuild 打包 + Node 内置 `node:test` 运行，完全离线（模型调用 mock `fetch`），当前 304 条用例；`npm run test:patch` 保留为 Patch/命运状态回归脚本。
- **端到端 mock 链路测试**：`npm run test:e2e` 用本地 OpenAI 兼容 mock 服务器驱动真实 engine/store，43 条断言覆盖完整回合、工具调用轮、失败路径（截断、非法 JSON、HTTP 429）、store 落盘与缓存前缀结构。
- **存档体积与写入可靠性实测**：`npm run test:storage` 测量每回合字节增长、距 localStorage 配额的剩余回合数，并注入 `QuotaExceededError` 验证失败可见性。
- **`tests/llmClient.test.ts`**：补齐此前零覆盖的模型客户端（工具循环两个 HARD 缺陷的回归测试）。
- **`docs/known-issues.md`**：登记审查与测试中发现、尚未修复的问题（含严重度、影响路径与处理建议）。

### 修复

- **回合完成时正文闪烁重刷**：流式进行中与最终落盘原本是两套不同的元素结构，回合结束时 React 卸载一棵树、挂载另一棵；而 `.prose-story p` 带 `fade-in` 动画，节点一重挂载动画就重放，表现为正文整体重新淡入一次。现在两条路径共用 `StoryArticle` 组件、产出完全同构的 DOM，落盘容器再带 `prose-story--settled` 禁用正文动画。回归测试用 `renderToStaticMarkup` 断言标签骨架一致（`tests/storyArticle.test.ts`）。
- **提示词结构破坏前缀缓存（命中率上不去的主因）**：供应商的前缀缓存只认"从头开始逐字节相同"的部分，而写后结算的请求把约 1.9KB 的固定输出模板放在了每回合都变的正文**之后**，模板因此永远无法命中；模板里还内嵌了每回合随机生成的 `commitId`，即使位置对了也逐字节不同；`baseRevision` / `turn` 两个递增的值又排在模板开头，把后面整段字段说明的复用性再次截断。现在三个阶段统一为「固定指令与输出模板 → 可变材料」，`commitId` 移出模板（改由 `【TURN_ID】` 行给出，提交时仍由程序覆盖），注入值挪到模板末尾，权威状态 JSON 也改为稳定字段在前、`scene/summary/progress/turn/revision/recent` 在后。实测可复用前缀：结算阶段 34.2% → 67.0%，三个阶段合计约 25% → 56.9%（最小存档下；真实存档比例更高）。
- **`cache_read_input_tokens` / `cache_creation_input_tokens` / DeepSeek 原生缓存字段读不到**：缓存字段此前只在 `cache` 嵌套对象里查找，而 DeepSeek 把 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 放在 `usage` 顶层，Anthropic 把 `cache_read_input_tokens` 放在顶层——两者都读不到，直连时缓存命中永远显示 0。
- **`input_tokens` 与 `prompt_tokens` 口径混用导致输入量少算**：OpenAI 风格的 `prompt_tokens` 已是完整输入量，而 Anthropic / DeepSeek 风格的 `input_tokens` 只表示未命中部分，完整量需加上缓存读写（与 DSH 的 `totalTokens = input + output + cacheRead + cacheWrite` 一致）。现在按字段组合判别口径，而不是按字段名猜。
- **未命中量被误派生成 0，算出 100% 的假命中率**：只带 `prompt_cache_hit_tokens` 的中间帧曾被当成完整输入量。现在总量只从可信来源取，数据不足时留空、界面显示"—"，同时新增 `cacheHitRate` / `formatCacheHitRate` 与缓存写 token 字段。
- **后到的残缺 usage 帧把已统计的缓存量抹成 0**：流式响应中多个 usage 帧先后到达，后者可能只重复部分字段。缓存计数改为取较大值（一次请求内单调不减），顶层 `promptTokens` 仍按每个请求各自取值。
- **`superseded` 缺少有效替代者时虚增结局完成度**：`replacementBeatId` 只校验非空、不校验存在性，指向不存在的故事节时状态仍被置为 `superseded`，而结局判定把所有 `superseded` 视为已完成 → 可能提前触发结局。现在必须指向真实存在的故事节，否则降级为 `reframed` 并发警告；已落库的历史坏数据会在下次提交时回收。不会卡住流程：`endingReached` 只记录状态、不终止游戏。
- **多处静默丢弃/静默改写改为可观察**：人物 `create` 缺 `name`、线程 `create` 缺 `title`（此前会退化为按 id 覆盖已有线程且不校验 reason）、枚举字段收到表外取值、工具调用帧缺 `function.name`——现在都会产生进入活动流的警告；人物 aliases 与线程 `involvedCharacterIds` 的 create 分支补齐与合并/update 分支一致的去重。
- **世界书 priority 区间统一**：工坊保存夹 `[0,100]`、内容库校验允许 `[-10000,10000]`，导致"保存 → 导出 → 再导入"静默改写；两处现已同区间。
- **存档会撞上 localStorage 配额，且写入失败完全不可见**：每回合把三阶段完整提示词留档写进 `lrpg.v2`，实测 30 回合达 6.21 MB（其中留档占 97.8% 的字节），约第 26 回合即超限；超限后内存状态继续前进而磁盘停在旧值，刷新丢档。现在持久化时剔除 `calls[].input`（30 回合 6212 KB → 420 KB，距配额约 337 回合），并用自定义 `StateStorage` 把写入失败提升为可渲染的 `persistError`（异常照旧上抛），游戏页渲染持久化告警横幅。
- **`<think>` 标签变体会吞掉整回合正文**：只认逐字符相等的 `</think>`，模型写出 `</think >`、`</THINK>` 时其后正文全部被判为思考内容，回合以"空内容"失败。现在归一化标签再拆分，并加"无规范标签时按正文返回"的安全网。
- **工具循环丢掉已生成的最终 JSON**：模型在同一轮里既给出完整 JSON 又发起工具调用、末轮只回空内容时，原实现只取末轮文本导致整回合失败。现在回退到最后一个非空文本。
- **工具轮次用尽直接抛错**：末轮改用 `toolChoice:'none'` 阻止继续调用，仍请求工具时用已有内容收尾而非打掉整回合（并顺带修掉由此暴露的潜在无界调用）；仅当从未产出可用文本时才抛错。
- **世界书的 `alwaysActive` / `keywords` / `priority` 完全失效**：关键词门控从未生效，未命中的条目（含尚未发生的伏笔）每回合都被注入，`priority` 不起作用且第 21 条起静默丢弃。现在按常驻 + 关键词命中筛选、按优先级排序，截断时发活动流警告。
- **枚举未写进提示词导致静默强转**：`postShape` 只给 `"status":"active"` / `"kind":"item"`，模型输出中文枚举时被白名单静默改写（人物死亡记为活跃）。现在写全枚举并补充"不得翻译枚举""superseded 需 replacementBeatId""endingReached 的联合门槛"三条规则；同时补全 `scene` / `actions` 的字段结构（原先只给 `null` / `[]`）。
- **随机事件说明在未到期回合被丢弃**：`lastNote` 是纯审计文本（前端显示为「随机事件结果」），此前只在事件到期分支记录。现在所有分支都记录，调度字段仍然只在到期时改动；前端相应只在事件真的触发过之后才显示为结果。
- **`availableActions` 在状态写入层不校验内容**：规整逻辑已抽到 `src/lib/actions.ts` 的 `normalizeChoices`，由 `engine` 与 `patch` 共用——任何绕过 engine 直接提交 Patch 的调用方都不再能写进空 label 的按钮。
- **检索工具可用性**：证据改为按实际命中的词做窗口切片（此前只截前 900 字，长回合返回的证据可能不含查询词），中文单字人名不再被分词丢弃，工具描述补上适用/不适用场景与 `scope` 取值含义。
- **未闭合的 `<think>` 会吞掉整段正文**：拆分器此前只在存在半个标签前缀时才 flush，导致"未闭合的 think 块"永远等不到收尾判定——内容留在思考里、正文为空、回合以"模型返回了空内容"失败。现在 `finish()` 总是收尾；闭标签从未出现时把内容判为正文并补发给流式消费者。同时把"JSON 写在 `<think>` 里"的场景也纳入兜底（此前被 `!tagThinking` 条件排除）。
- **世界书优先级可在全区间使用**：工坊输入框放开到 `-10000 ~ 10000`（此前夹 `0 ~ 100`，与内容库的校验区间不一致，导致保存→导出→再导入静默改写），并补上"数字大的先注入"的说明。
- **显式 0 不再被当成"没填"**：随机事件间隔的 `Number(x) || 3` 会把刻意的 0 变成默认值 3；现在只有 `undefined`/`NaN` 回退默认值，0 照实夹到最小值 1。
- **`lrpg.v2` 补上格式版本与迁移层**：读旧档时补齐缺失字段（缺 `facts[].keywords`、`storyThreads`、`destiny.beats`、`inventory` 的存档此前会在 `snapshot()` 抛 `TypeError`，而且是在已经花掉两三次模型调用之后）；结构坏到无法修复的条目被丢弃而不是拖垮整个存档集；由更新版本写入的存档原样保留并进入只读提示，不再被本程序重新解读后写回（那会静默抹掉它不认识的新字段）。
- 设置页"写前规划和写后结算分别计算工具次数"的文案与实现矛盾（结算阶段从不挂载工具），已更正。
- 删除零引用的 `src/lib/toast.ts`（其渲染组件早已随 V1 清理删除）。
- `tsconfig.json` 的 `include` 从 4 个路径改为 `["src"]`：此前大量文件不在类型检查范围内，`src/types/game.ts` 被删除后仍被十余个文件 import 而无人发现。
- `extractJSONText` 贪婪匹配导致解析失败：模型在 JSON 之后继续输出文字、或一次返回多个对象时整体不是合法 JSON，直接返回 `null`，使整回合失败。改为逐个 `{` 做括号平衡扫描（跳过字符串字面量与转义引号），返回首个可解析对象；并修复了两个由复核发现的衍生问题——截断输入会退而返回内层对象（现在返回 `null`）、逐候选扫描在病态输入上退化成 O(n²)（200 KB 未闭合括号需 124 秒，现在 200 万个耗时 2 ms）；合法 JSON 在非法 fence 之前时不再被整体丢弃。
- `mergeLlmUsage` 用 `undefined` 覆盖已知缓存统计：`normalizeLlmUsage` 产出的 cache 必带三个键（值可能为 `undefined`），对象展开会把上一帧已拿到的 `hitTokens` 覆盖掉。改为逐字段 `??` 合并，且只写入真正有值的字段。
- Patch 缺 `latestProgress` 时清空进度：`summary` 与 `latestProgress` 现在统一走 `textOrPrevious`，"空串/空白串视为未提供、保留旧值"。此前的 `raw || previous` 写法无法拦住 `'   '`（truthy），清洗后仍会变成空串。

### 文档

- 重写 `AGENTS.md`：原内容描述的是 V1 结构（`useGameStore.ts`、`services/storyAgent.ts`、`src/prompts/*`、`runStory/runChoices/dispatch` 等均不存在），已按 V2 实况重写运行命令、代码结构、路由、存储键与协议改动清单。
- 重写 `PROJECT_HANDOFF.md`：改为记录本次接手发现的问题、处理方式、验证结果与仍需人工完成的事项。
- 同步 `docs/PROJECT_STATUS.md`（存储键、测试体系、已移除的遗留部分）与 `docs/README.md`（标注归档文档中的失效路径）。
- `README.md` 补充测试与开发文档索引。
- `docs/cache-prefix-investigation.md`：前缀缓存的四个失效点查证（含 DSH 源码与 DeepSeek 官方文档依据、真实请求体的字节级测量）。
- `docs/cost-analysis.md`：一次真实三回合游玩的成本实测与优化优先级（输出占 82% 费用、时段差价 2 倍、缓存优化上限约 16%）。
- `docs/multiround-generation-evaluation.md`、`docs/planner-multiround-evaluation.md`：两次"要不要多轮"的评估（含 29 个真实回合的量化证据与被证伪的假设）。
- `docs/frontend-interaction-polish.md`：四项前端交互优化的成因与实现。

## [0.3.0] - 2026-07-16

### 新增

- 新增“故事工坊”，支持自定义故事大纲、幕、故事节、结局方向与世界书条目。
- 支持复制内置“错位青春”作为自定义故事参考。
- 自定义故事保存在浏览器中，支持编辑、复制、删除与 JSON 导入/导出。
- 新增规划模型上下文预算、故事上下文查询工具、工具调用上限和 DeepSeek 兼容选项。
- 新增实时生成活动树，可查看模型推理、工具调用、阶段状态和 Token/缓存用量。
- 新增消息队列、取消、终止、重试与修改最近输入后重新生成。
- 新增慢速、标准、快速和时间跨越四种叙事节奏。

### 重构

- 重写为命运驱动的 V2 双模型故事链路：规划写前、故事生成、规划写后、程序提交。
- 使用结构化幕与故事节维护长期故事目标，并允许玩家偏航后迁移关键故事功能。
- 将人物、关系、物品、任务、事实、摘要与故事进度改为程序侧权威状态。
- 清理旧多 Agent、司书库、回合上限、选项刷新和不再支持的角色模型逻辑。
- 重建主要前端界面和聊天交互，同时保留成熟版本的视觉语言。

### 修复

- 修复无玩家输入时可能自动推进下一回合的问题。
- 修复后台切换、终止或旧请求返回时可能产生重复提交的问题。
- 修复规划活动状态显示在错误回合、工具开关错位等交互问题。
- 加强结构化 Patch 校验、事实去重和故事节状态更新的容错。

### 兼容性

- V2 不兼容旧版存档。
- 自定义故事和存档均为浏览器本地数据，升级或清理站点数据前建议导出备份。

## [0.2.0] - 2026-05-07

- 扩展执笔模式的分阶段叙事与提示词体系。
- 增加“错位青春”预设和一键启动入口。
- 项目许可证切换为 GPL-3.0。

## [0.1.0] - 2026-05-01

- 发布首个公开测试版本。
- 提供纯前端互动故事原型与基础模型设置。
