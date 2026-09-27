# 已知问题登记

本文件记录**代码审查与测试过程中发现的问题**，分三类：

1. **待决策**——不是缺陷，而是需要在"宽松 / 严格 / 保留数据"之间取舍的设计选择，需要项目所有者拍板。
2. **待观察**——确认是缺陷但影响极小、或触发条件在正常使用下不可达。
3. **已修复**——本轮接手改造中修掉的问题，附回归测试位置。

处理原则（来自 [`destiny-driven-story-core.md`](destiny-driven-story-core.md)）：**程序维护数据可靠性，不替模型做文学判断**。因此"静默丢弃模型输出"这类问题一律按缺陷处理（改成可见或不再丢弃），而"校验松紧"这类一律归入待决策。

---

# 一、待决策（真正的产品判断）

每条都已被测试固定当前行为，改动前先确认取舍。

### A. 世界书的 priority 区间 ✅ 已按决定处理

工坊输入框已放开到 `-10000 ~ 10000` 并加了说明；与内容库校验同区间，往返不再改写。

### B. 里程碑与收敛计划的"清除"表达方式 ✅ 已保留现状（不对称是有意的）

`nextMilestone` / `convergencePlan` 的**空串 = 清空**，其余 destingy 字段的空串 = 保留旧值。这是模型唯一的"里程碑已达成、可以撤下"表达方式，因此保留。**若将来要统一语义，必须同时给模型一个显式清除字段**，否则会失去删除能力。

### C. 库存 `grant` 的数量下限 ✅ 已按决定处理（严格照抄）

- 位置：`src/v2/patch.ts` 的库存分支
- 原行为：`grant` 用 `Math.max(1, …)`，模型写 `quantity: 0` 或负数也会 +1，等于程序篡改了模型的数量意图。
- 现行为：严格照抄——缺失时按 1，`0` 表示"这次不增加"，负数表示"减少这么多"；新物品在数量 ≤ 0 时不创建条目；减到 0 或以下时按既有的"数量 > 0"规则过滤，不留数量为 0 的幽灵条目。
- 回归测试：`tests/patch.test.ts`。

### D. `setActive` 不校验存档是否存在 ✅ 保持现状

程序侧 API，UI 只传列表里的 id；传错时 `useActiveSaveV2` 返回 undefined，`GamePage` 有兜底渲染。

### E. 显式 `triggerIntervalMin: 0` 被当成默认值 ✅ 已修

`Number(x) || 3` 会把显式的 0 当成"没填"（UI 不可达，但语义含糊）。现在只有 `undefined`/`NaN` 回退默认值，0 照实进入区间夹取（夹到最小 1）。

### F. 未到期的随机事件 note 被丢弃 ✅ 已修

- 生命周期：写前规划安排事件（`lastPlan`）→ 程序的 `dueRandomEvent` 判断到期 → 写后结算回报 `handled` 与 `note`（`lastNote`，前端显示为「随机事件结果」）。
- 原行为：`lastNote` 只在"事件到期"分支里记录，未到期回合的 note 被无声丢弃。
- 修复：`lastNote` 是纯审计文本、不参与调度，现在所有分支都记录；调度字段（`pending` / `nextTriggerTurn` / `intensity` / `lastTriggeredTurn`）仍然只在到期时改动。前端相应改为"只在事件真的触发过之后才显示为结果"，避免未发生过事件时出现误导文案。
- 回归测试：`tests/patch.test.ts`。

### G. `thinkingFallback` 恢复的 JSON 同时出现在思维链里 ✅ 已修

恢复为正文的内容现在会从思考里移除（两个来源：原生思考通道 + 正文里的 `<think>` 块），且恢复内容会通过 `onDelta` 补发给流式消费者，实时界面不再空白。

### H. 「可选行动」的清洗放在哪一层 ✅ 已修（下沉到状态写入层）

- 数据流：`planner_post` 输出 `actions` → 规整成 `{id,label,hint}` → 存进 `availableActions` → 游历模式在游戏页渲染成可点击按钮。
- 原缺陷：规整只在 `engine` 做，而 `patch.ts` 只 `slice(0,4)`。任何绕过 engine 直接提交 Patch 的调用方（脚本、测试工具、未来新增入口）都能写进**空 label 的按钮**，点下去会把空输入送进回合队列。
- 修复：抽出 `src/lib/actions.ts` 的 `normalizeChoices`（去空、trim、去重、限长、限 4 条），`engine` 与 `patch` 共用同一份实现，两条路径规则不再可能漂移。
- 回归测试：`tests/patch.test.ts`。

---

# 二、待观察（已决定暂时忽略）

以下条目确认是缺陷，但影响极小或正常使用下不可达。**2026-04 决定：暂时忽略，不再逐条排期**；若将来真的在游玩中触发，再从这里取。每条都保留复现路径与建议修法。

### I. `lrpg.v2` 没有 persist `version` 与 `migrate` ✅ 已修（见"已修复"一节）

- 位置：`src/v2/store.ts`（对比 `useContentStore` 有 `version: 3` 与 `sanitizePersistedContent`）
- 现象：手工改过或截断过的存档若缺 `facts[].keywords`、`storyThreads`、`destiny.beats`、`inventory` 等字段，会在 `snapshot()` 阶段抛 `TypeError`——而且是在**已经发出若干次模型调用之后**，本轮成本全部作废。
- 触发面：正常升级不会缺字段（键与字段同批引入），属"坏档 / 未来加字段漏兼容"风险。
- 建议：加 `version` + `migrate` 链与 `normalizeGameStateV2` 字段兜底；`persisted.version > CURRENT` 时进入只读提示而不是硬解读。

### J. `stream_options` 重试的触发条件过宽，且重试后 usage 丢失

- 位置：`src/services/llmClient.ts` 的 `shouldRetryWithoutStreamOptions`
- 现象：`unknown parameter` / `unrecognized request argument` 这类文案也被当作"不支持 stream_options"，于是去掉 `stream_options` 重发；若真实原因是 `thinking` / `reasoning_effort` / `response_format` 被拒，重发仍会失败。仅在非 2xx 时触发，**不存在重复计费**。成功重试后该阶段 usage 为空（Token 面板留白）。
- 建议：按字段名精确匹配错误文案，并在重试成功后也尽力取回 usage。

### K. `tool_call` 缺少 `index` 时多个调用会被合并串位

- 位置：`src/lib/sse.ts` 的工具调用聚合
- 现象：供应商不回 `index` 时按帧内下标兜底，两帧各一个调用会被合成一个，`arguments` 拼接成非法 JSON，模型收到"query不能为空"。
- 建议：无 `index` 且已存在同 id 调用时按 `id` 归并，而不是按下标。

### L. 检索证据按前 900 字截断，但命中判定用全文

- 位置：`src/v2/engine.ts` 的 `clipContextEvidence` 与 `searchStoryContext`
- 现象：命中发生在长文本后段时，返回给模型的"证据"里可能不含查询词。
- 建议：按命中位置做窗口切片（前后各 300 字）。

### M. `contextSearchTerms` 丢弃 CJK 单字

- 位置：`src/v2/engine.ts`
- 现象：`"晴 在哪里"` 因 `晴` 长度 < 2 被丢弃，检索返回 0 条；单字中文人名检索不到。
- 建议：CJK 单字保留，或对 CJK 做 bigram 展开。

### N. 检索评分里的 magic 加权可能压过最相关的正文证据

- 位置：`src/v2/engine.ts` 的 `searchStoryContext` 排序（`facts` +4、非 history +2）
- 现象：内容恰好等于查询词的正文消息会排在结构化 facts 之后。
- 建议：加权降级为次级排序键，先按命中密度归一。

---

# 三、已修复（本轮接手改造）

### ✅ 库存数量被程序篡改（`grant` 强制至少 +1）

- 位置：`src/v2/patch.ts`
- 现象：`grant` 用 `Math.max(1, …)`，模型写 `quantity: 0`（这次不增加）或负数（减少）时都会被改写成 +1。
- 修复：严格照抄模型给的数量；缺失时按 1；新物品数量 ≤ 0 不创建；减到 0 或以下按既有规则过滤。
- 回归测试：`tests/patch.test.ts`。

### ✅ 检索工具：返回的"证据"经常不含查询词；中文单字检索不到

`search_story_context` 的两个可用性缺陷，都会让模型"查了却什么也没得到"：

1. **证据按前 900 字截断**，而命中判定用全文。长回合里关键词落在 1200 字之后时，返回的证据里根本没有查询词，模型只会看到一段无关开头。现在按**实际命中的词**定位，以命中位置为中心做窗口切片，并在两端标出省略。
2. **分词把长度 < 2 的词全部丢掉**，中文单字人名（"晴"）因此无法检索。现在中文单字保留，只有拉丁字母才要求长度 ≥ 2。

同时把工具描述改成面向操作的说明（列出适用场景与不适用场景），`scope` 参数补上每个取值的含义，"查不到"的提示改为建议改用更短的人名/地点/事件词。

回归测试：`tests/engine.test.ts`（单字检索命中、长正文窗口切片必须包含查询词）。

### ✅ `superseded` 缺少有效替代者时虚增结局完成度

- 位置：`src/v2/patch.ts`
- 现象：`replacementBeatId` 只校验非空、不校验存在性。指向不存在的故事节时状态仍被置为 `superseded`（替代者不写入），而结局判定把所有 `superseded` 视为已完成 → **可能提前触发结局**，同时那个替代者永远不会存在。
- 是否会把故事卡住？**不会**。`endingReached` 只记录状态、不终止流程（`phase` 仍回落 `input`），所以原实现是判定失真而非死锁。
- 修复：`superseded` 必须指向大纲中真实存在的故事节，否则**降级为 `reframed`** 并发 `superseded_replacement_missing` 警告。选择降级而非整条丢弃，是因为模型很可能重复提交同一个无效替代者，整条丢弃会让该节永远无法被标记。
- 同时回收历史坏数据：已落库的"无替代者 superseded"在下次提交时降回 `reframed`（警告 `superseded_replacement_dangling`），重新计入待完成。
- 回归测试：`tests/patch.test.ts`。

### ✅ 多处"静默丢弃 / 静默改写"改为可观察

| 位置 | 原行为 | 现行为 |
|---|---|---|
| 人物 `create` 缺 `name` | 静默跳过 | 警告 `character_create_without_name` |
| 人物 aliases（create 分支） | 不去重，与合并分支不一致 | 两分支共用 `cleanList` |
| 线程 `create` 缺 `title` | **退化为按 id 覆盖已有线程**（不校验 reason） | 整条忽略 + `thread_create_without_title` |
| 线程 `involvedCharacterIds`（create 分支） | 不去重 | 与 update 分支一致 |
| 枚举字段收到表外取值（`status` / `kind` …） | 静默回退默认值 | 回退 + `enum_value_coerced` |
| 工具调用帧缺 `function.name` | 静默丢弃 | 丢弃 + `tool_call_without_name`（经 SSE → llmClient → 活动流） |

`commitTurnPatchV2` 新增可选 out 参数 `warnings`，签名与返回类型不变；`engine` 把提交阶段的警告一并送入活动流。回归测试：`tests/patch.test.ts`、`tests/sse.test.ts`。

### ✅ Responses（`/responses`）链路整体移除

- 现象：`apiFormat` 在界面上没有任何入口，Responses 相关代码对用户是死代码；且该格式下 `thinkingMode` / `reasoningEffort` / `plannerJsonMode` / 工具开关全部静默失效。
- 处理：删除 `buildResponsesBody`、`responsesEndpoint`、SSE 的 responses 分支与 `StreamOptions.format`、`AppSettings.apiFormat`（旧存档里的该字段会被忽略），并同步清理相关测试。现在只支持 Chat Completions。
- 保留：usage 的 `input_tokens` / `output_tokens` / `*_tokens_details.cached_tokens` 别名归一化——那是通用供应商差异，不是 Responses 专属。

### ✅ 存档体积撞上 localStorage 配额，且写入失败完全不可见

- 现象（30 回合实测）：`lrpg.v2` 达 **6.21 MB**，其中 `turnRecords[].calls[].input`（三阶段完整提示词留档）占 **6.08 MB = 97.8%**；每回合增长 212 KB（留档 208 KB + 正文状态 4.5 KB），约第 26 回合即超出常见的 5 MB 上限。
- 更严重的是失败方式：写入被拒后内存状态**已经前进**，磁盘却停在旧值——玩家以为在玩，刷新即丢档。
- 修复：持久化时剔除 `calls[].input`（出参、思维链、usage 全部保留）→ 30 回合 6212 KB 降到 **420 KB**，距配额从约 26 回合提升到约 **337 回合**；自定义 `StateStorage` 把写入失败提升为可渲染的 `persistError`（异常照旧上抛），`GamePage` 渲染持久化告警横幅。
- 依据与验证：`npm run test:storage`（增长率、可达回合数、注入 `QuotaExceededError` 验证失败可见性）。

### ✅ Patch 缺 `latestProgress` 时清空进度

- 位置：`src/v2/patch.ts` 的返回分支
- 现象：曾判定为"链路不可达"，复核时用真实 `runTurnV2` 证明在线可达——该字段会作为下一轮规划模型的 `progress` 注入，清空即丢失上一轮进展。
- 修复：新增 `textOrPrevious(raw, previous, max)`，`summary` 与 `latestProgress` 统一为"空串/空白串视为未提供、保留旧值"。注意 `raw || previous` **拦不住 `'   '`**（truthy），清洗后仍会变成空串。

### ✅ `extractJSONText` 贪婪匹配导致解析失败

- 位置：`src/lib/utils.ts`
- 现象：原实现 `/\{[\s\S]*\}/` 贪婪匹配到最后一个 `}`，模型在 JSON 之后继续输出文字或一次返回多个对象时整体不是合法 JSON，返回 `null`，使整回合失败。
- 修复：改为逐个 `{` 做括号平衡扫描（跳过字符串字面量与转义引号），返回首个可解析对象；并修复两个衍生问题——截断输入会退而返回内层对象（现在返回 `null`）、逐候选扫描在病态输入上退化成 O(n²)（200 KB 未闭合括号需 124 秒，现在 200 万个耗时 2 ms）；合法 JSON 位于非法 fence 之前时不再被整体丢弃。

### ✅ `mergeLlmUsage` 会用 `undefined` 覆盖已知缓存统计

- 位置：`src/lib/llmUsage.ts`
- 现象：顶层用 `??`（缺失保留），cache 却用对象展开；`normalizeLlmUsage` 产出的 cache 必带三个键（值可能为 `undefined`），展开后会把上一帧已拿到的 `hitTokens` 覆盖成 `undefined`。
- 修复：cache 逐字段 `??` 合并，且只写入真正有值的字段。

### ✅ `<think>` 标签的空白/大小写变体会吞掉整回合正文

- 位置：`src/lib/sse.ts`
- 现象：只认逐字符相等的 `</think>`。模型写出 `</think >`、`</ think>`、`</THINK>` 时闭标签匹配不上，其后所有正文被判为思考内容、`text` 为空，回合以"模型返回了空内容"失败——而模型其实写完了。
- 修复：标签归一化后再拆分（保持字符偏移），并加"正文为空但思考里没有规范 `<think>` 块时按正文返回"的安全网。

### ✅ 工具循环丢掉已生成的最终 JSON / 工具轮次用尽直接抛错

- 位置：`src/services/llmClient.ts`
- 现象一：模型常在"发起工具调用的同一轮"里就把最终 JSON 写完、末轮只回空 `stop`；原实现只取末轮文本 → 回合失败。修复：回退到最后一个非空文本。
- 现象二：模型用满轮次后再请求一次工具就抛错打掉整回合，且末轮仍向模型声明工具。修复：末轮 `toolChoice:'none'`；仍请求工具时用已生成内容收尾且**不再发起新请求**（否则 `round` 会越过上限变成无界调用——这个次生缺陷是被新增测试抓出来的）；只有从未产出可用文本时才抛错。
- 回归测试：`tests/llmClient.test.ts`（新增文件，此前该模块零覆盖）。

### ✅ 世界书的 `alwaysActive` / `keywords` / `priority` 完全失效

- 位置：`src/v2/engine.ts` 的稳定上下文注入
- 现象：原实现只做 `slice(0, 20)`——未命中关键词的条目（含尚未发生的伏笔）每回合被无条件注入，`priority` 不起作用，第 21 条起静默丢弃；而工坊界面明确承诺"常驻每轮提供、关键词条目仅在相关时加入"。
- 修复：`selectWorldFacts` 按 `alwaysActive` + 关键词命中（当前输入 + 最近 6 条历史）筛选，再按 `priority` 降序截断；命中数超限时发 `world_facts_truncated` 警告。被截断内容仍可由 `search_story_context` 检索，不会真正丢失。

### ✅ 人物 `status` / 道具 `kind` 的枚举没写进提示词

- 位置：`src/v2/engine.ts` 的 `postShape`
- 现象：模板只给 `"status":"active"` 与 `"kind":"item"`，模型无法得知还有 `absent|missing|dead|unknown` 与 `ability|quest_item`；中文提示词下模型输出中文枚举时被白名单静默强转——**人物死亡被记成活跃、任务道具降级为普通物品**，UI 里那套标签永远显示不出来。
- 修复：模板写全枚举（与 `oneOf` 白名单逐字一致），补充"枚举不得翻译或自造同义词""`superseded` 必须给出真实存在的 `replacementBeatId`""`endingReached` 的联合门槛"三条规则，并补全 `scene` / `actions` 的字段结构（原先只给 `null` / `[]`）；同时新增 `enum_value_coerced` 警告兜底。
