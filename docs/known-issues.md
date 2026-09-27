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
