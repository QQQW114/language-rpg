# 已知问题登记（待决策）

本文件登记**代码审查与测试过程中发现、但尚未修复**的问题。清理接手时已修复的两条见文末。

处理原则（来自 [`destiny-driven-story-core.md`](destiny-driven-story-core.md)）：**程序维护数据可靠性，不替模型做文学判断**。因此下列问题需要先判断"这是 bug 还是刻意的宽松设计"，再决定是否修改；直接收紧校验可能违背产品定位。

每条都记录了严重度、影响路径与建议，测试中对应行为**已被断言固定**（标注为"当前实现边界"），修改时同步更新测试即可。

---

## P1 · 建议尽早决定

### 1. `superseded` 缺失替代者时仍计入结局判定

- 位置：`src/v2/patch.ts:149/157/161`
- 现象：`replacementBeatId` 只校验非空，不校验是否真实存在。指向不存在的故事节时，状态仍会被置为 `superseded`，但 `replacementBeatId` 不写入，于是产生"没有替代者的 superseded"；而结局判定把所有 `superseded` 节视为已满足，可能**提前触发结局**。
- 测试：`tests/patch.test.ts:612`
- 建议：二选一——(a) `replacementBeatId` 不存在时整体丢弃该条变更；(b) 保留 superseded 但不写入无效 id，并在结局判定中排除无替代者的 superseded。方案 (a) 更符合"引用完整性"，但会丢掉模型的一次状态推进；(b) 更宽松。**属于产品判断，需你决定。**

### ✅ 2.（已修复）Patch 缺 `latestProgress` 时会清空进度

- 位置：`src/v2/patch.ts:193`（原 `text(patch.latestProgress, 500)`）
- 现象：补丁缺 `latestProgress` 时写入空串而不是保留旧值。
- 影响：**在线可达**。已用 mock fetch 驱动真实 `runTurnV2` 复现：结算 JSON 同时不含 `latestProgress` 与 `roundSummary` 时，`state.latestProgress` 由旧值变成 `''`。该字段会作为下一轮规划模型的 `progress`（`engine.ts:382`）注入，清空即丢失上一轮进展。
- 修复：新增 `src/lib/utils.ts` 的 `textOrPrevious(raw, previous, max, fallback)`，`summary` 与 `latestProgress` 都改为"空串/空白串视为未提供，保留旧值"。
  - 注意 `raw || previous` 这种写法**不够**：`'   '` 是 truthy，会绕过回退、清洗后变成空串。这个坑由本次复核发现。
- 回归测试：`tests/patch.test.ts`「latestProgress 缺省或为空时保留旧进展」。

> 该修复属于纯数据保留，不改变任何校验松紧，因此按"不替模型做文学判断"的原则可以直接修。

## P2 · 记录待观察（无已知实际影响）

### 15. 存档体积与写入可靠性 ✅ 已修复（见文末）

### 16. `lrpg.v2` 没有 sanitize/merge —— 缺字段的旧存档会在 3 次模型调用后才崩

- 位置：`src/v2/store.ts` 的 persist 配置（对比 `useContentStore` 有 `sanitizePersistedContent` 与 `version`）
- 现象：手工改过或截断过的存档若缺 `facts[].keywords`、`storyThreads`、`destiny.beats`、`inventory` 等字段，会在 `snapshot()`/`buildPlannerPreSystem` 阶段抛 `TypeError`。因为抛点在 planner 之后，**已经烧掉的模型调用全部作废**。
- 触发面：正常升级不会缺字段（键与字段同批引入），因此属于"坏档/未来加字段漏兼容"风险。
- 建议：加 `version: 2` + `migrate` 链，并补一个 `normalizeGameStateV2` 把缺省字段补齐；`persisted.version > CURRENT` 时进入只读提示而不是硬解读。
- 测试：`tests/store.test.ts` 目前不覆盖缺字段 hydrate。

### 17. `apiFormat` 在界面上没有任何入口

- 位置：`AppSettings.apiFormat` 仅被 `engine.ts` 与 `llmClient.ts` 读取；`SettingsPage.tsx` 没有对应控件
- 影响：Responses 链路（`buildResponsesBody`、`detectFinishReason` 的 responses 分支、相关测试）对用户是**死代码**；且该格式下 `thinkingMode` / `reasoningEffort` / `plannerJsonMode` / 工具开关全部静默失效，界面无任何提示。
- 建议：要么在设置页补一个格式选择器（并标注各格式下哪些选项不生效），要么明确声明只支持 Chat Completions。
- 测试：`tests/llmClient.test.ts` / E2E 已覆盖两种格式的请求形状，可作为补 UI 后的验收依据。

### 18. 检索证据按前 900 字截断，但命中判定用全文

- 位置：`src/v2/engine.ts` 的 `clipContextEvidence` 与 `searchStoryContext` 的评分
- 现象：命中发生在长文本后段时，返回给模型的"证据"里可能**不含查询词**。
- 建议：按命中位置做窗口切片（前后各 300 字），而不是只取开头。

### 19. `contextSearchTerms` 丢弃 CJK 单字

- 位置：`src/v2/engine.ts`
- 现象：`"晴 在哪里"` 因为 `晴` 长度 < 2 被丢弃，检索返回 0 条；单字中文人名会检索失败。
- 建议：CJK 单字保留，或对 CJK 做 bigram 展开。

### 20. 检索评分里的 magic 加权可能压过最相关的正文证据

- 位置：`src/v2/engine.ts` 的 `searchStoryContext` 排序（`facts` +4、非 history +2）
- 现象：内容恰好等于查询词的正文消息会排在结构化 facts 之后。
- 建议：加权降级为次级排序键，先按命中密度归一。

### 21. `stream_options` 重试的触发条件过宽，且重试后 usage 丢失

- 位置：`src/services/llmClient.ts` 的 `shouldRetryWithoutStreamOptions`
- 现象：`unknown parameter` / `unrecognized request argument` 这类文案也被当作 `stream_options` 不支持，于是去掉 `stream_options` 重发；若真实原因是 `thinking` / `reasoning_effort` / `response_format` 被拒，重发仍会失败。仅在非 2xx 时触发，**不存在重复计费**。成功重试后该阶段 usage 为空（Token 面板留白）。
- 测试：`tests/llmClient.test.ts` 尚未覆盖该分支。

### 22. tool_call 缺少 `index` 时多个调用会被合并串位

- 位置：`src/lib/sse.ts` 的工具调用聚合
- 现象：供应商不回 `index` 时按帧内下标兜底，两帧各一个调用会被合成一个，`arguments` 被拼接成非法 JSON。
- 建议：无 `index` 且已存在同名/同 id 调用时按 `id` 归并，而不是按下标。

## P3 · 观察项（非 bug）

### 3. 空串语义在 destiny 字段间不对称

- 位置：`src/v2/patch.ts:133-138`
- `completionReason / currentActId / currentStage / currentPath`：空串 → **保留旧值**；`nextMilestone / convergencePlan`：空串 → **清空字段**。模型漏字段或给空串时行为不一致。
- 建议：统一为"空串视为未提供"（保留旧值），或在提示词中明确空串含义。

### 4. 去重规则在成对分支间不一致

- 人物：`src/v2/patch.ts:27`（合并分支用 `Set` 去重 aliases）vs `:32`（create 新建分支不去重）。
- 线程：`src/v2/patch.ts:86`（create 不去重 `involvedCharacterIds`）vs `:93`（update 去重）。
- 影响：仅数据整洁度，无功能影响。
- 建议：把去重下沉为共用小工具，两分支统一调用。

### 5. 库存 `grant` 的数量下限与未知 `op` 行为

- 位置：`src/v2/patch.ts:70/75`
- `grant` 使用 `Math.max(1, …)`：`quantity: 0` 或负数仍然 +1（无法表达"给 0 个"，但可避免模型输出 0 导致无意义条目）。
- 未知或缺失 `op` 且 id/name 命中已有物品时，只刷新 `updatedAtTurn`，语义含糊。
- 建议：明确记录为设计选择；若要收紧，未知 `op` 应整条忽略。

### 6. `op: 'create'` 缺 `title` 时落入 update 分支

- 位置：`src/v2/patch.ts:82`
- 现象：会按 id 直接改已有线程的 kind/status/progress，且不校验 reason，与 create 语义不符。
- 建议：create 缺 title 时整条忽略，而不是退化为 update。

### 7. 未到期时提交的随机事件备注被丢弃

- 位置：`src/v2/patch.ts:169-191`
- 现象：未到期（既非 pending 也未到 `nextTriggerTurn`）时，补丁里的 `randomEvent.handled/note` 被完全忽略，`note` 丢失；`enabled: false` 时即使 `handled: true` 也不重排 `nextTriggerTurn`。
- 建议：确认是否有意为之；若 `note` 只是审计信息，可考虑在未到期时也记录 `lastNote`。

### 8. priority 取值范围在工坊与内容库之间不一致

- 位置：`src/v2/workshop/model.ts:198-201`（夹到 `[0, 100]`）vs `src/lib/contentLibrary.ts:146`（允许 `[-10000, 10000]`）
- 影响：工坊保存会把负 priority 抬到 0；现存预设无负值，暂无实际影响。
- 建议：统一区间（建议都用 `[0, 100]`，或都放宽）。

### 9. `setActive` 不校验存档是否存在

- 位置：`src/v2/store.ts:129`
- 配合 `useActiveSaveV2` 会得到 `undefined`；`GamePage` 有兜底渲染，其他调用方需自行判断。

### 10. 显式 `triggerIntervalMin: 0` 被当成默认值 3

- 位置：`src/v2/store.ts:60-62`（`Number(x) || 3`）
- 影响：0 与"未提供"不可区分（负数反而会走 clamp 变成 1）。启程页 `min=1`，实际不可达。

### 11. 无 name 的 tool_call 被静默丢弃

- 位置：`src/lib/sse.ts:295`
- 现象：模型只回 arguments 而缺 `function.name` 的异常帧被过滤掉，不会报错。
- 建议：可改为保留并以空名上报，让上层工具循环回报"未知工具"，便于排障。

## P3 · 观察项（非 bug）

### 12. thinkingFallback 恢复的 JSON 会同时出现在思维链里

- 位置：`src/v2/engine.ts:617-619` + `src/lib/sse.ts:276`
- 现象：规划 JSON 通过思考通道恢复时，同一段 JSON 既作为正文提交，又因原始增量已作为 thinking delta 上报而进入`assistant.thinking`，造成导出内容里重复。
- 影响：仅"导出正文+输入+思维链"的可读性。

### 13. `plannerToolsEnabled` 在 Responses 格式下被忽略

- 位置：`src/v2/engine.ts:606`
- 现状：源码注释说明是刻意规避向不支持该链路的格式发送虚假工具声明；测试已固定该行为。设置页文案已标注"实验性偏好"。

### 14. `availableActions` 在 patch 层不校验内容

- 位置：`src/v2/patch.ts:193`
- 现象：只做 `slice(0, 4)`，空 label 的选项会原样写入（清洗在 `engine.normalizeActions`）。直接调用 patch 层时可能出现空选项。
- 建议：若希望 API 自洽，可在 patch 层补 `label` 非空过滤。

---

## 已在本次接手改造中修复

### ✅ 存档体积撞上 localStorage 配额，且写入失败完全不可见

- 现象（30 回合实测）：`lrpg.v2` 达 **6.21 MB**，其中 `turnRecords[].calls[].input`（三阶段完整提示词留档）占 **6.08 MB = 97.8%**；每回合增长 212 KB，其中留档 208 KB、正文与状态仅 4.5 KB。约第 26 回合就会超出浏览器常见的 5 MB 上限。
- 更严重的是失败方式：写入被拒后 zustand 的内存状态**已经前进**，磁盘却停在旧值——玩家以为在玩，刷新即丢档。
- 修复：
  1. `partialize` 持久化时剔除 `calls[].input`（出参、思维链、usage 全部保留）。实测 30 回合从 6212 KB 降到 **420 KB**，距配额从约 26 回合提升到 **约 337 回合**。
  2. 自定义 `StateStorage` 包住 `localStorage`：失败时写入 `persistError`（含 `quotaExceeded` 标记与可操作建议）**并把异常继续抛出**（保留原有可见性），成功后自动清空。`GamePage` 渲染持久化告警横幅。
- 回归测试与证据：`scripts/e2e-storage-growth.mjs`（`npm run test:storage`）实测增长率、可达回合数，并注入 `QuotaExceededError` 验证"异常上抛 + 标志位设置 + 恢复后清空"。
- 仍未处理的取舍：刷新后**历史回合**的提示词明细不再可导出（当次会话内仍完整），已写入 README 级说明。

### ✅ Patch 缺 `latestProgress` 时清空进度

见上文第 2 条（曾判定为"链路不可达"，复核时用真实 `runTurnV2` 证明是在线可达的数据丢失）。

### ✅ `extractJSONText` 贪婪匹配导致解析失败
- 位置：`src/lib/utils.ts`
- 原实现 `cand.match(/\{[\s\S]*\}/)` 贪婪匹配到最后一个 `}`：模型在 JSON 之后继续输出说明文字、或一次返回多个对象时，整体不是合法 JSON，直接返回 `null`，进而让 `runTurnV2` 的 `requireJSONObject` 抛错、整回合失败。
- 修复：改为逐个 `{` 做括号平衡扫描，跳过字符串字面量内部的括号与转义引号，返回**首个可解析**的对象。
- 回归测试：`tests/utils.test.ts`（多对象取首个、前一片段非法时继续尝试、`}` 出现在字符串内、转义引号）。

### ✅ `mergeLlmUsage` 会用 `undefined` 覆盖已知缓存统计

- 位置：`src/lib/llmUsage.ts`
- 原实现顶层用 `??`（缺失保留），cache 却用对象展开：`normalizeLlmUsage` 产出的 cache 必带三个键（值可能为 `undefined`），展开后会把上一帧已拿到的 `hitTokens` 覆盖成 `undefined`。两处语义自相矛盾且丢失已知真实数据。
- 修复：cache 逐字段 `??` 合并，并只写入真正有值的字段（与 `normalizeLlmUsage` 的稀疏写法一致）。
- 回归测试：`tests/llmUsage.test.ts`（跨两帧保留命中、三轮合并、无 cache 时不产出空对象）。

### ✅ `<think>` 标签的空白/大小写变体会吞掉整回合正文

- 位置：`src/lib/sse.ts` 的 think 拆分器
- 现象：只认逐字符相等的 `</think>`。模型写出 `</think >`、`</ think>`、`</THINK>` 时闭标签匹配不上，**其后所有正文都被当作思考内容**，`text` 为空 → 引擎抛"模型返回了空内容"，整回合作废，而模型其实写完了。
- 修复：标签归一化后再拆分（`<\s*/?\s*think\s*>` → 规范形式，原地替换保持偏移）；并加安全网——正文为空但"思考"里没有规范 `<think>` 块时，把内容按正文返回，绝不因收尾不规范就丢掉整段正文。
- 回归测试：`tests/sse.test.ts`（四种闭标签变体、四种开标签变体、闭标签始终缺失的兜底）。

### ✅ 工具循环只取末轮文本，丢掉第 0 轮已写好的 JSON

- 位置：`src/services/llmClient.ts` 的工具循环
- 现象：模型常在"发起工具调用的同一轮"里就把最终 JSON 写完，末轮只回一个空的 `stop`。原实现只返回末轮 `text`，于是返回空串 → 引擎抛"模型返回了空内容"，整回合失败。
- 修复：循环内记住最后一个非空文本，末轮为空时回退到它，并把该文本补给 `onDelta` 消费者；`finishReason` 同步回退。

### ✅ 工具轮次用尽直接抛错，且末轮仍向模型声明工具

- 位置：`src/services/llmClient.ts`
- 现象：模型用满轮次后再请求一次工具就抛错打掉整回合；而 `engine` 侧的工具 handler 本意是优雅降级（返回"已达到上限，请基于现有证据完成"），两者语义矛盾。
- 修复：末轮改用 `toolChoice:'none'`（不再声明 tools），物理上阻止继续调用；末轮仍请求工具时直接用已生成内容收尾，**不再发起新请求**（否则 `round` 会越过上限变成无界调用循环——这个次生缺陷是被新增测试抓出来的）；只有在从未产出任何可用文本时才抛错，保留失败可见性。
- 回归测试：`tests/llmClient.test.ts`（新增文件，此前 `llmClient` 零覆盖）。

### ✅ 世界书的 `alwaysActive` / `keywords` / `priority` 完全失效

- 位置：`src/v2/engine.ts` 的稳定上下文注入
- 现象：原实现只做 `slice(0, 20)`，**未命中的关键词条目每回合都被无条件注入**——工坊界面明确承诺"常驻条目每轮提供；关键词条目仅在最近上下文相关时加入"，实际等于把尚未发生的伏笔提前摊给模型；`priority` 也完全不起作用，第 21 条起永久丢弃且无任何提示。
- 修复：按 `alwaysActive` + 关键词命中（当前输入 + 最近 6 条历史）筛选，再按 `priority` 降序排序后截断；命中数超过上限时发 `world_facts_truncated` 警告进入活动流。被截断内容仍可由 `search_story_context` 按需检索，因此不会真正丢失。
- 回归测试：`tests/engine.test.ts`（未命中不注入、命中注入 planner 与 story、优先级排序与 20 条上限）。

### ✅ 人物 `status` / 道具 `kind` 的枚举没写进提示词

- 位置：`src/v2/engine.ts` 的 `postShape`
- 现象：模板只给 `"status":"active"` 与 `"kind":"item"`，模型无从得知还有 `absent|missing|dead|unknown` 与 `ability|quest_item`。中文提示词下模型输出中文枚举（如 `"死亡"`、`"能力"`）时，`patch.ts` 的白名单会**静默强转**为 `active`/`item`——人物死亡被记成活跃，任务道具降级成普通物品，且没有任何警告。UI 里那套"死亡/失踪"标签因此永远显示不出来。
- 修复：模板改为写全枚举（与 `oneOf` 白名单逐字一致），并补三条规则文字：枚举不得翻译或自造同义词、`superseded` 必须给出 `replacementBeatId`、`endingReached` 的联合门槛。同时修掉模板里 `scene`/`actions` 只给 `null`/`[]` 的问题（代码实际要读五个 scene 子字段与 action 的 id/label/hint）。
