# 前缀缓存调研：为什么命中率上不去，以及统计为什么不可信

> 缘起：harness（DSH）的缓存命中率常年在 99% 以上，而本项目未必用对了方式；另外"缓存命中率 / 用 token 数"这些显示本身可能不可靠，前端对对话的保护与改写也可能有问题。
>
> 本文把这个问题拆成**四个独立失效点**，逐个查证（含 DSH 源码、DeepSeek 官方文档与本地实测），列出已修复的缺陷与仍未解决的问题。

---

## 零、结论速览

| # | 失效点 | 查证结果 | 状态 |
|---|---|---|---|
| 1 | 提示词前缀是否稳定 | **有真缺陷**：固定输出模板被放在可变正文之后，且模板里内嵌了每回合随机的 `commitId` | ✅ 已修 |
| 2 | 缓存统计的解析口径 | **有真缺陷**：只认嵌套写法，读不到 DeepSeek 原生字段；且未命中量被误派生成 0 | ✅ 已修 |
| 3 | 前端对消息历史的保护与改写 | 未发现破坏缓存前缀的改写；历史是纯追加，符合缓存友好的形态 | ✅ 已核查（见第五节） |
| 4 | 命中率的计算与显示 | **有真缺陷**：把"只报命中量"当成完整输入量，会算出 100% 的假命中率 | ✅ 已修 |

---

## 一、缓存的前提：只认"从头开始逐字节相同"的前缀

缓存不是本项目的实现细节，而是供应商的行为。查证了两处权威说明：

**DeepSeek 官方文档**（[上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)）明确：

- 「用户的每一个请求都会触发硬盘缓存的构建。若后续请求与之前的请求**在前缀上存在重复**，则重复部分只需要从缓存中拉取」；
- 「每条缓存前缀是一个**独立的完整单元**。后续请求只有在**完整匹配**缓存前缀单元时，才能命中缓存」；
- 缓存单元在三处落盘：请求的用户输入结束位置、模型输出结束位置，以及「按固定 token 间隔落盘」；
- 命中情况通过 `usage` 的两个字段反映：`prompt_cache_hit_tokens`（命中）、`prompt_cache_miss_tokens`（未命中）。

**DSH 的适配器文档**（`@deepseek-ai/dsh-llm-deepseek`）在"KV Cache effect"一节给出了同样的工程结论：

- 「**An unchanged assembled prefix is eligible for DeepSeek cache reuse**」——不变的前缀才有资格复用；
- 「Loop-retained response blocks append to the next request and **preserve its earlier reusable prefix**」——把上一轮的回复块**追加**到下一次请求，从而保住之前那段可复用前缀。

**这两条合起来给出可执行的判据**：

1. 请求的消息顺序必须是"固定的在前、每回合变化的在后"；
2. 追加式增长（历史只往后加）是缓存友好的，**在中间插入或重排是缓存杀手**；
3. 任何"每回合随机/递增"的值（时间戳、随机 id、turn、revision）都必须排在它所在序列块的末尾。

### 官方文档里一条容易被忽略的规则

「按固定 token 间隔落盘」意味着：**即使某个长前缀从未在别的请求里出现过，它也会被切成缓存单元**。所以"把固定内容放前面"不只是为了复用上一次请求，而是为了让**第一次出现**的长固定块也能变成可命中的单元。

### DSH 的统计口径（用于对照）

`@deepseek-ai/dsh-llm-deepseek` 的 usage 归一化与总量计算：

```js
// lib/index.js
cache_read_input_tokens: "cacheReadTokens",
cache_creation_input_tokens: "cacheWriteTokens"
// ...
usage.totalTokens = usage.inputTokens + usage.outputTokens
  + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
```

也就是说在 Anthropic / DeepSeek 口径下，**`input_tokens` 是"未命中缓存的部分"**，完整输入量必须加上缓存读写。`@deepseek-ai/dsh-token-meter` 把这一项直接命名为 `uncachedInputTokens`，语义一致。

---

## 二、失效点 1：提示词前缀（有真缺陷，已修）

### 修复前的实际字节布局（本地实测）

用 E2E harness 采集真实请求体，逐字段量出位置：

```
planner_post 阶段
  system 提示词：1987 字符（各回合固定 → 可缓存）
  user 消息：3829 字符
    【TURN_ID】                         位置    0   ← 每回合都不同，第一个字节就分叉
    【AUTHORITATIVE_STATE_BEFORE_TURN】 位置   33
    【CURRENT_TURN_INPUT】              位置 1400
    【CURRENT_WRITE_PLAN】              位置 1400
    【CURRENT_STOP_BOUNDARY】           位置 1813
    【CURRENT_STORY】                   位置 1847
    严格按下列结构输出 + 输出模板        位置 1892  ← 约 1.9KB 的固定模板在最后
  ⇒ 可缓存前缀 = system 1987 字符 / 总计 5816 字符 = 34.2%
```

问题一目了然：**约 1.9KB 的固定输出模板被放在了每回合都变的正文之后**，因此它永远不可能命中缓存。真实游玩时正文可达 13,000 字符，同一条消息里的固定模板完全被埋在可变数据的后面。

### 第二个缺陷：模板里内嵌了每回合随机的 commitId

`postShape` 原本含 `"commitId":"COMMIT_ID"`，而 `commitId` 是 `genId('commit')` 每回合新生成的。**即使把模板挪到最前，它本身也逐字节不同，依然无法复用。**

修法：把 `commitId` 从模板里彻底移除，改由可变区的 `【TURN_ID】` 行给出。这不会丢功能——`asPatch()` 本来就用程序自己的 `commitId` 覆盖模型输出（`src/v2/engine.ts`），模型不回显它也照样提交。

### 第三个问题：模板里两个每回合必变的值排在开头

`baseRevision` / `turn` 的值每回合递增，原本紧跟在 `schemaVersion` 后面，会把后面那 ~2KB 字段说明的可复用性再次截断。现在这两个字段挪到模板**末尾**，中间整段字段说明成为稳定的缓存前缀（提交时模型照抄即可，程序仍以 `baseRevision` 守卫为准）。

### 三个阶段的结构修复

统一改成"**固定指令与输出模板 → 可变材料**"：

| 阶段 | 修复后顺序 |
|---|---|
| planner_pre | system → STABLE_STORY_CONTEXT（稳定） → **输出模板** → AUTHORITATIVE_STATE → CURRENT_TURN_INPUT → 节奏/随机事件 |
| story | system → STABLE_STORY_CONTEXT（稳定） → **写作要求**（节奏、随机事件指令、写作计划、约束、停止边界） → AUTHORITATIVE_STATE → CURRENT_TURN_INPUT |
| planner_post | system → **固定指令 + 输出模板** → baseRevision/turn → TURN_ID → 状态 → 输入 → 写作计划 → 正文 |

同时把权威状态 JSON 的字段顺序也调整为"稳定在前、每回合必变在后"：`mode / narrativePace / characters / relationships / facts / threads / inventory / destiny / randomEvent` 在前，`scene / summary / progress / turn / revision / recent` 在后（`scene` 每回合几乎必变，原来排在数组之前，会把后面整段截断）。

### 实测改进幅度（E2E，最小状态）

| 阶段 | 修复前可复用前缀 | 修复后可复用前缀 |
|---|---|---|
| planner_pre | 约 19%（system 579 / 3035） | **44.3%** |
| story | 约 20% | **50.3%** |
| planner_post | **34.2%** | **67.0%** |
| 合计 | 约 25% | **56.9%** |

这是**最小存档**下的比例（权威状态只有 1.4KB）。真实存档里可变部分大幅增长而固定部分不变，因此实际可复用比例会比这更高。

---

## 三、失效点 2：usage 解析（有真缺陷，已修）

### 缺陷 A：读不到 DeepSeek 的原生缓存字段

DeepSeek 的字段在 `usage` **顶层**：`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。而原实现只在 `cache` 嵌套对象里找这两个名字（`cacheObj.prompt_cache_hit_tokens`），从不读顶层。**结果是：用 DeepSeek 直连时，缓存命中永远显示为 0。**

### 缺陷 B：`input_tokens` 口径混用

原实现用 `prompt_tokens ?? input_tokens ?? ...` 简单合并。但两者口径不同：

- OpenAI 风格 `prompt_tokens` = **完整输入量**，`prompt_tokens_details.cached_tokens` 是它的子集；
- Anthropic / DeepSeek 风格 `input_tokens` = **未命中部分**，完整量 = `input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens`（DSH 的做法见第一节）。

简单合并会把 Anthropic 风格的输入量**少算一部分**（少了缓存读写的量），输入总量显示偏小。

### 缺陷 C：把"只有命中量"当成完整输入量，造出 100% 假命中率

在原实现里 `{ prompt_cache_hit_tokens: 4 }` 会被归一化成 `promptTokens: 4`——把命中量当成了总量，于是未命中被派生成 0，命中率算出 100%。这类数据在**流式响应的中间帧**里很常见。

### 修法

`src/lib/llmUsage.ts` 现在按**字段组合**判别口径，而不是按字段名猜：

| 出现的字段组合 | 判定 | 完整输入量 |
|---|---|---|
| `prompt_tokens` | OpenAI 风格 | `prompt_tokens` 本身 |
| `input_tokens` + `prompt_cache_miss_tokens` | DeepSeek 原生 | `input_tokens` + 缓存读写 |
| `input_tokens` + `cache_read_input_tokens` / `cache_creation_input_tokens` | Anthropic | `input_tokens` + 缓存读写 |
| `input_tokens` + `input_tokens_details.cached_tokens` | OpenAI 兼容代理 | `input_tokens` 本身（cached 是子集，**不相加**） |
| 只有缓存字段、没有总量 | 数据不足 | **留空**，不猜 |

另外补了两条：

- `total_tokens` 缺失时按"输入 + 输出"补，而不是留空让界面显示 0；
- 未命中量缺失但总量与命中量都在时，用"总量 − 命中"派生，这样供应商只报命中也能算命中率。

### 缺陷 D：后到的残缺帧会把已统计的量抹成 0

一次流式响应里会先后到达多个 usage 帧，后面的帧可能只重复其中一部分字段。原来 cache 字段是"后者覆盖前者"，于是 `{hit:900, miss:100}` 之后来一个 `{hit:900}`，未命中量就被抹成 0。现在缓存计数改用**取较大值**（这些计数在一次请求内单调不减），顶层 `promptTokens` 仍按"后者覆盖前者"（它是每个请求各自的量，不该跨请求取最大值）。

---

## 四、失效点 4：命中率的计算与显示（有真缺陷，已修）

### 缺陷：分母选错

界面原来只显示"缓存命中 N"的绝对值，而 DSH 那样显示百分比需要正确的分母。实现这类计算时有两个常见错误，我在开发过程中**两个都犯过并被测试抓出来**：

1. 用"命中量"当分母 → 恒等于 100%（已由 `cacheHitRate` 的单测钉死）；
2. 用"命中 + 未命中"当分母 → 未命中量可能只是部分统计，分母不可信。

现在的定义（`src/lib/llmUsage.ts`）：

```
命中率 = 命中量 / promptTokens（归一化后已是完整输入量）
```

- **只在 `promptTokens` 存在时计算**，否则返回 undefined、界面显示为"—"（宁缺勿假）；
- **不把输出算进分母**：输出从不进 KV 缓存，混进来只会让命中率莫名偏低。

### 界面

游戏页「本轮模型活动」面板的 Token 行现在显示：

```
本轮总计 输入 12.4k 缓存命中 10.2k（82.3%） 未命中 2.2k 输出 1.1k 合计 13.5k
```

每阶段与合计行都会显示命中率；某阶段数据不足时该阶段不显示百分比，而不是显示 0%。

---

## 五、失效点 3：前端对消息历史的保护与改写（已核查，未发现破坏缓存的问题）

逐一核查了历史消息的生命周期：

| 环节 | 是否改写历史 | 是否破坏缓存前缀 |
|---|---|---|
| 追加玩家输入与模型回复（`engine.ts` 回合末尾） | **纯追加** | 不破坏。这正是 DSH 说的"appended blocks preserve the earlier reusable prefix" |
| 持久化（`store.ts` 的 `partialize`） | 只剔除 `lastTurnCheckpoint` 与 `turnRecords[].calls[].input`，**不动 `history`** | 不破坏 |
| 历史回退（`reportingStorage` 失败时/`restoreLastTurn`） | 用回退点替换**整个 state** | 不破坏前缀结构（退回到的是历史版本，前缀本就一致） |
| 上下文注入（`recentHistoryWithinBudget`） | 不改写历史，只在提示词里选取窗口 | 窗口是从**最新往前**取，导致取到的段落在请求里的位置会随回合漂移（见第六节） |
| 存档载入时的字段兜底（`sanitizeGameStateV2`） | 只补缺失字段，不重排已有字段 | 不破坏 |

**结论**：没有发现"前端改写把已命中的前缀改坏"的情况。历史是追加式的，这与缓存友好的形态一致。

一条值得记下的正确性细节：`snapshot()` 里的 `recent` 用的是**从最新往里回溯**的窗口，于是相邻两回合的 `recent` 内容集合会整体滑动（上一回合的 recent 是 [n-6..n-1]，本回合是 [n-5..n]）。这意味着 `recent` 段几乎每回合都会整体变化——但它被放在**请求的最末尾**，因此并不影响它前面的前缀。这就是为什么"把可变内容压在最后"这条规则比"让每个字段都稳定"更重要。

---

## 六、仍未解决 / 需要你判断的

### A. `recent` 窗口的滑动让尾部永远无法复用（可接受，但可优化）

现状：`recent` 每回合整体滑动，尾部（最近 6~8 条正文，可达数千字符）每回合都不同，无法命中缓存。
可选优化：把窗口改成**按"已落盘回合边界"对齐**（例如固定注入最近 4 个完整回合，而不是按 token 预算动态截取），这样相邻回合的 `recent` 前缀能对上。代价是要放弃按 token 预算的自适应，可能撑爆上下文。
**需要你判断**：是否值得为缓存命中牺牲"按预算自适应"这一特性。

### B. 无法测量真实命中率（缺真实 Key）

现在的命中率全部来自 mock（不返回缓存字段），只能验证**解析与显示逻辑**正确，无法验证真实命中率。
**需要你配合**：配好 Key 后跑一轮长局（`node scripts/e2e-storage-growth.mjs 30` 或直接玩十几回合），把活动面板上的命中率告诉我。如果第一回合后命中率仍低于 80%，说明还有别的前缀破坏点在（下一步该查的是 `snapshot()` 里数组的稳定增长模式与 `selectWorldFacts` 的选取稳定性）。

### C. 三个阶段的缓存前缀彼此独立（可合并，代价高）

现在 planner_pre / story / planner_post 是**三条独立请求序列**，各自重新构建前缀。理论上可以让 planner_post 复用 story 请求的前缀（把 story 的消息作为前缀、只追加一轮指令），但那样 planner_post 就会看到 story 阶段的完整上下文与工具声明，改变它的输入语义。
**需要你判断**：是否要为此改动链路结构。我的建议是不改——收益有限，而"结算只看到它该看的东西"是当前提示词设计的一条重要约束。

### D. `stream_options` 重试会让 usage 丢失（已知，影响小）

沿用 `docs/known-issues.md` 的登记：`shouldRetryWithoutStreamOptions` 的触发条件过宽，且重试成功后该阶段 usage 可能为空——那会让该阶段的命中率显示为"—"。属于已知小问题，按你上次的意见"影响小的暂时忽略"未修。

---

## 七、复现方式

```bash
node scripts/e2e-mock-flow.mjs          # 生成真实请求体
node test-runs/probe-prefix.mjs         # 量出各阶段的可复用前缀与占比
```

单元测试里已固化结构约束（`tests/engine.test.ts` 的"前缀缓存结构"三例）：

- system 提示词与稳定上下文在相邻回合必须**逐字节相同**；
- 固定模板段（到注入值为止）必须**逐字节相同**且体量 > 1500 字符；
- 每回合必变的 `baseRevision` 必须排在字段说明之后；
- 固定模板里不得出现 `commitId`。

这些测试已验证过**能抓住回归**：把注入值挪回模板开头时，可复用前缀从 1900+ 字符掉到 62 字符，测试立即失败。
