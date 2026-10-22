# 提示词设计记录（Prompt Pack v2 / v2.1）

> 来源：2026-10-20 与外部模型（Gemini）的四轮评审 + 项目侧真实 A/B 验证。这里只保留可复用的结论与规则，原始评审记录已清理；当前提示词实现见 [`prompt-list.md`](prompt-list.md)。

## 1. 问题诊断

- 旧版（v1）文风的主要问题：状态标签直接当人名（"仗义型舍友" 48 次）、`【stopBoundary】` 标记泄漏进正文、慢镜头/秒表词、网文套话、"盯视计时器"式怀疑、把设定摘要直接塞进角色台词。
- 结构归因：**约 65% 来自双模型分工与提示词结构，约 35% 来自 `deepseek-flash` 的蒸馏腔**。只换强模型不改结构，慢镜头与"念设定"不会自动消失。
- 五个结构性病根：
  1. `planner_pre`（低温、JSON）写出概括腔的 `writingBrief`，`story` 被要求"严格执行"，于是让 NPC 原样背出设定关键词；
  2. `stopBoundary` 细到微动作（"先看脸、隔两秒、整个人定在那里"），又要求单回合约 1,100 字 → 只能靠慢镜头注水；
  3. 缺少"已确立日常一笔带过"的详略规则 → 8 个回合重复 300 字变身/换装/查证件流程；
  4. story 的 user 消息注入 7 个工程元字段（`currentAct`、`activeBeatIds`、`destinyProgress` 等），模型以为在写状态机日志；同时把临时外貌词（"抱书女生"）固化成跨场景人名；
  5. 缺少正向表演指导，"怀疑但未点破"退化为连续 6 次"视线多停半秒"。
- 全文通读另发现：跨日输入后旧"今晚九点/五点"限时事务不关闭，变成跨日僵尸死线；`stopBoundary` 被模型打印进正文。

## 2. 采纳的改法（已落地）

### v2：分工重写

- `planner_pre`：`beatsThisTurn` 只写必须落地的客观结果；`writingBrief` 只写场景处境、隐秘顾虑、核心戏剧张力，禁止代写台词/微动作；`stopBoundary` 改为"戏剧悬置切面"；日常流程要求一笔带过。
- `story`：去法条化，加入场景纵深、反 AI 味铁律、泛化人物声线（主角/同辈/事务型前辈/敏锐观察者，不写死姓名）与两组"坏→好"微示范。
- story 的 user 消息删除 7 个工程元字段，末尾追加 `【WRITING_EXECUTION_ANCHOR】` 近因锚点。
- `planner_post`：`satisfied` 允许按"实质兑现叙事功能"判定；人物 `name` 必须取真名/固定昵称，禁止临时描述固化。

### v2.1：闭环校准

- 节拍结果必须在 `stopBoundary` 之前成立；单回合要包含 2~3 轮实质交锋（自然 800~1,200 字），不得在 NPC 第一句提问时就停笔。
- 跨日输入自动作废前一日限时事务；已实质走完功能的 active 节拍及时结案。
- 锚点从 5 条 195 字压缩为一句 68 字，回收 `reasoningEffort=high` 下的自我审查 token。

## 3. A/B 证据（同一批 20 条输入、`deepseek-flash`）

| 指标 | v1 | v2 | v2.1（15 回合验证） |
|---|---|---|---|
| 状态标签当人名 | 48 | 0 | 0 |
| `【stopBoundary】` 泄漏 | 1 | 0 | 0 |
| 慢镜头/秒表词 | 14 | 1 | 0~1 |
| 盯视计时器 | 4 | 0 | 0 |
| 正文中位字数 | 1,135 | 735 | **1,193** |
| <650 字回合 | 0 | 6 | **0** |
| 进入第三幕 | T12 | 未进入（T20 仍第二幕） | **T11** |
| T15 satisfied | 8 | 5 | **8** |
| 输出 tokens（15 回合） | — | 169,663 | 164,744（正文 +58%） |

结论：v2/v2.1 的文风指标是决定性的；篇幅与幕推进在 v2 出现回退，v2.1 已修复。模型发挥度估算：v1 约 35%，v2 约 72%，v2.1 + flash 约 82%~85%，v2.1 + `deepseek-v4-pro` 仅换 story 阶段约 92%~95%。

## 4. 过拟合审计（换模型时的取舍）

**保留（通用写作原则/结构护栏）**

- 规划/故事分工：结果底线 vs 场景创作；
- story 用户消息删除工程元字段；
- 状态标签不得当人名、系统标记不得进正文；
- 已确立日常 1 句话带过；
- "展示而非告知"、潜台词、泛化声线；
- `planner_post` 的弹性 `satisfied` 与真名规则。

**`deepseek-flash` 专病（换强模型可降级）**

- 句式黑名单（"不是A而是B""先…然后…""定在那里"）：已内联为一段，而不是长篇独立清单；换强模型可进一步弱化为一行提示。
- 两组"坏→好"微示范：保持短小，避免模型照抄道具；换强模型可只留一组。
- 尾部近因锚点：对长上下文小模型有效；强模型可进一步压缩或去掉。

**不建议再做**

- 继续加长黑名单/禁令（过拟合风险、且会推高思考 token）；
- 为了"去片感"放开 `beatsThisTurn` 上限或取消 `stopBoundary`（会破坏幕状态机）；
- 给 `planner_post` 增加文风审计字段（它只做状态结算）；
- 把动态人物设定注入 system/user#1（会击穿前缀缓存）；
- 用 `max_tokens` 硬截断来控制篇幅（会在停笔前腰斩，导致结算找不到证据）。

## 5. 模型分级建议

- 日常/轻量档：三阶段都用 `deepseek-flash` + v2.1（当前生产基线，单回合约 1,100~1,200 字）。
- 高优品质档：只把 **story** 阶段切到 `deepseek-v4-pro`，`planner_pre` / `planner_post` 继续用 flash；提示词无需改动。
- 不建议三阶段全换 pro：规划/结算在 v2.1 下准确率已足够，成本与延迟收益不划算。

## 6. 已知边界与后续

- 节奏审计是保守启发式：已剔除引号台词与"今天/明天/上周 + 时段"组合，但意象式升华仍可能漏报；检测只影响下一轮软纠偏，不回滚正文。
- v2.1 的 A/B 是同一批输入、单模型、每组 1 次长局 + 15 回合验证，不是统计意义上的多次重复；若要评估新模型，建议按"3 切片 × 3~5 次采样 + 20 回合长局"复核。
- 提示词已到 flash 的甜点区：继续增删提示词的边际收益很低，优先换模型或改程序机制（如状态压缩/上下文预算），不要继续堆规则。
- 修改提示词时同步：`prompt-list.md`、`tests/engine.test.ts` 的注入断言、`npm run test:e2e`、以及 `docs/prompt-design-log.md` 的结论。

## 7. gemini-4-argon 复审（v2.2，2026-10-21）

第二轮复审基于 20 回合 gemini-3.8-flash-high 长局与 61 个真实回合，得出两个取证结论 + 五类改法，已落地为 v2.2。

### 7.1 两个取证结论

1. **T2 295 字 / T3 660 字不是“提示词过短”，是反代 SSE 半句腰斩**：全量 61 回合句尾扫描，正常回合 100% 以终结标点收尾；3 个异常回合（T11 6 字、T2 295 字、T3 660 字）全部无句尾标点。旧 `<80 字` 护栏只拦住 6 字。v2.2 改为“长度 ≥120 且句尾必须有终结标点”，61 回合检出率 3/3、误杀 0。
2. **planner_post 非法 JSON 的根因是 evidenceQuote 内英文双引号未转义**：Gemini 会原样复制带台词的正文句子；v2.2 在 planner_post system 源头约束“字符串值内部引号一律用「」/『』/单引号”，并在修复重试指令中重复该要求。
3. **反代还会把供应商错误文本当正文返回**：v2.2 验证时 gemini 反代把“sensitive words / could not be submitted”的内容审核错误作为 story 输出，长度 322 字、带句号，长度与标点护栏都拦不住；现已增加供应商错误文本识别，命中即拒绝提交。

### 7.2 采纳的改法

- **P0-1 去掉“写透写扎实”**：强模型会追加 120~180 字段末总结陈词（“双方轨迹未咬合/没人起疑”）；v2.2 明确“已体现结果即停笔，严禁段末总结/复盘/替读者归纳”。
- **P0-2 黑名单降级**：Gemini 命中的“秒表词/否定排比”多为正常口语；真正问题是“不是具象A，而是抽象概念B”与高频浓妆副词（骤然/猝然/死死/硬生生等）。v2.2 改为通用文学原则。
- **P0-3 反复读**：长局 T6→T7 把“太监答到/黄焖鸡菜单”重复演了一遍；planner_pre 增加“已演过的包袱、玩梗、已确认信息不得在本轮 writingBrief 中复读”。
- **P1-4 按模型分 profile**：`compact` 保留正反微示范、800~1200 字、完整锚点；`expressive` 省略微示范（省 token）、900~1300 字、38 字短锚点。`resolveStoryProfile()` 按 story 模型自动选择（gemini/claude/gpt-5/pro 等 → expressive；deepseek-flash → compact）。
- **D 职责拆分**：叙事速度四档改为纯镜头焦距/剪辑节奏；`【STORY_AUTONOMY】` 三档正式文案接管“推多远”，并约束 `beatsThisTurn` 上限（strict 1 / standard 2 / free 3）。

### 7.3 仍需后续处理

- **混合端点**（planner pre/post 用 deepseek-flash + story 用 gemini）被复审强烈推荐，可腰斩延迟并找回缓存；当前设置只有一个 API Base，程序暂不支持按阶段分端点，需后续改造。✅ 已实现（T2，见 §8.1）。
- **阶段级重试复用**：story 流中断时复用已成功的 planner_pre（不重抽随机事件），预计再省 35% 恢复时间；本轮只做了整回合/结算重试，尚未实现。✅ 已实现（T3，见 §8.2）。
- `expressive` profile 目前按模型名自动选择，暂未提供设置页手动覆盖；等下一轮观察后再决定是否加开关。
- T3 截断发生的 20 回合组，其 T4 之后上下文受截断正文污染；评估长局文风时以 T1/T2 与其他预设组为主。

### 7.4 v2.2.1：篇幅带单一来源（2026-10-21）

v2.2 落地后复核发现，除了 `【STORY_AUTONOMY】` 之外仍有三处会提供第二套篇幅 / 展开目标（strict 档最明显），它们与单一来源直接冲突。v2.2.1 只做收口，不新增规则：

1. **profile 不再携带数值篇幅带**：`compact` 原写「800~1200 字」、`expressive` 原写「900~1300 字」，与 `【STORY_AUTONOMY】` 的 strict 400~800 / standard 800~1200 / free 1000~1500 构成多套来源。现在 profile 只保留「正反微示范开关 + 近因锚点长短」，story system 的篇幅指引统一写「目标篇幅以【STORY_AUTONOMY】为准」。
2. **planner_pre `stopBoundary` 去掉“共同决定”**：原文「轮数与篇幅由【STORY_AUTONOMY】与【NARRATIVE_PACE】共同决定」会让规划模型把叙事速度当成第二套篇幅来源。现在改为「单回合的交锋轮数与篇幅以【STORY_AUTONOMY】为准，叙事速度只调整镜头焦距与时间流速」。
3. **story 正文与近因锚点去掉硬编码轮数**：正文原写「通过 2~3 个来回的当场对手戏」、compact 锚点原写「充分展开 2~3 轮」，在 strict 档（只要求直接反馈）下与 STORY_AUTONOMY 打架。现在两处都删掉具体轮数，改为「展开幅度以【STORY_AUTONOMY】为准」。
4. **补一条显式优先级**：story system 声明「若其他块（profile/锚点/节奏）与【STORY_AUTONOMY】的篇幅目标冲突，以【STORY_AUTONOMY】为准」——以后再加块也不会长出第二套数字。

**测试断言方式**（`tests/engine.test.ts`，两条 profile 用例重写）：

- story system 中不得出现 `\d+~\d+字` 形式的数值篇幅带（compact / expressive 各断言一次）；
- 数值篇幅带只允许出现在 `【STORY_AUTONOMY】` 注入给模型的 user 消息里；
- story system 必须包含「目标篇幅以【STORY_AUTONOMY】为准」与上述显式优先级句；
- planner_pre system 不得出现数值篇幅带，且 `stopBoundary` 必须包含「单回合的交锋轮数与篇幅以【STORY_AUTONOMY】为准」；
- compact 锚点保留完整版、expressive 保留短锚点；compact 锚点必须包含「展开幅度与篇幅均以【STORY_AUTONOMY】为准」且不得包含 `2~3轮`。

当前用例数：engine **95** 条（含 T2/T3 新增 16 条）、全量 **602** 条（24 个测试文件）、e2e **44** 条，均通过。

### 7.5 T4 真实链路验证（v2.2.1，2026-10-21）

数据源：`test-runs/v22-validation.md`（T4 正式报告）+ `test-runs/v221-*.json`；基线 commit `8950fbb`（含 v2.2.1 修复与 `LRPG_AUTONOMY`）。固定输入、单次采样，不是写作质量 A/B。

| 组 | 模型 × 预设 | 回合 | 关键数字 |
|---|---|---|---|
| A | deepseek-flash × 错位青春（standard） | 20/20 | 字数 p50 **1275** / max **2002**；延迟 p50 64.9s；0 截断 / 0 结算失败；3 次切幕，终态 4/5 |
| B/C/D | deepseek-flash × 错位青春（strict / standard / free，各 3） | 3/3 | 均值 **638 / 1126 / 1477** 字，逐回合单调分离 |
| E | gemini × 余温代行人（standard） | 3/3 | 字数 1702/1368/1242（p50 1368）；延迟 124/90/115s |
| F | gemini × 错位青春（standard） | 3/3 | 字数 1577/1193/1029（p50 1193）；1 次 planner_pre 非法 JSON 被自动修复 |
| G | gemini × 错位青春（standard） | **20/20** | 字数 p50 **1421** / max **1786**；延迟 p50 **116.7s**（约 deepseek 的 1.7 倍）；62/62 请求 200；**19/19 随机事件 resolved 且绑定合法**；3 次切幕，终态 4/5 完成度 75%；反代暖机缓存 pre 5.2% / story 0.4% / post 0% |
| H | 混合端点：planner/post deepseek-flash + story gemini × 余温代行人（standard，T2b） | 3/3 | 9/9 请求 200（planner base 6 / story base 3）；字数 1501/1639/1900（p50 1639）；**planner 缓存保留 pre 31.9% / post 28.3%，story 反代 0%**；2/2 随机事件 resolved、切幕 1 次；0 warning |

- **单一来源生效**：同 3 条输入下 strict / standard / free 单调分离（均值 638 / 1126 / 1477，逐回合顺序一致），说明删除 profile 硬编码篇幅带后，`【STORY_AUTONOMY】` 确实成为唯一有效的篇幅控制点；
- **G 组稳定性**：gemini 反代 20 回合 20/20、62/62 HTTP 200、0 内容审核拦截、0 结算失败，状态机 / 随机事件闭环正常；T12 出现一次 story 截断（65 字、无句尾标点）被 engine 拒绝提交，基线（T3 之前）harness 整回合重跑成功、多花 2 次请求；T3 落地后应只重跑 story，尚未在新基线复测；
- **H 组混合端点（T2b）**：planner/post 走官方 deepseek、story 走 gemini 反代，3/3 回合、9/9 请求 200；`turnRecord.calls` 确认 story 每回合都走独立 base + 独立模型，planner 前缀缓存保留（pre 31.9% / post 28.3%）、story 无缓存（0%），符合混合端点预期；
- **known issue（不阻塞发布）**：standard 档系统性超上限（A 组 13/20 >1200、3/20 >1500；G 组 p50 1421、4/20 >1500），属模型对软目标的漂移，不是链路错误，也不触发 pacing 纠偏（A 组 needsCorrection=0）；
- **caveat**：单次采样（20 回合组 n=1，三档组各 3 回合）、固定输入、gemini 反代无前缀缓存；数字只作方向与量级参考，不可外推。完整逐回合数据与复现命令见 `test-runs/v22-validation.md`；给 argon 的增量复审材料见 `docs/temp/gemini-4-argon-review/07-v2.2.1-validation-and-next-review.md`。

## 8. T2/T3 工程增强（2026-10-21）

提示词底稿稳定后，两处「不改变提示词、但直接影响真实长局可用性」的工程改造。

### 8.1 T2 混合端点（story 阶段独立连接）

- **背景**：复审强烈推荐的形态是 planner_pre / planner_post 走官方 DeepSeek（前缀缓存稳定、JSON 稳），story 走 Gemini 等更强模型或反代。此前设置只有一个 API Base，程序无法按阶段分端点，每轮都必须整体切到某个供应商。
- **实现**：设置新增可选 `storyApiBaseUrl` / `storyApiKey`，留空分别继承全局（可只覆盖其一）。engine 把连接拆成 `plannerCfg`（全局）与 `storyCfg`（story 覆盖）：planner_pre / planner_post / 结算 / 结算续跑始终用全局，只有 story 用覆盖；联网搜索、规划 JSON 模式与规划思考强度仍按全局端点判定；`reasoning_effort` 改为按**各阶段实际端点**决定是否发送（story 是非官方反代时不发它不认识的字段）。设置页新增「故事模型独立连接（可选）」区块，base / key 分别提示继承关系，独立 Key 只存本地、不回显 / 日志 / 活动流 / 导出报告。
- **兼容性**：默认两个字段为空串，旧设置经 normalize 后同样为空串，`storyCfg` 与 `plannerCfg` 逐字节相同——行为与单端点时完全一致。
- **真实冒烟（T2b，2026-10-21）**：基线 `438bb7a`，余温代行人 3 回合，planner/post = deepseek-flash（官方）、story = gemini-3.8-flash-high（本地反代）；3/3 完成、9/9 请求 200（planner base 6 / story base 3），`turnRecord.calls` 确认 story 每回合都走独立模型；planner 前缀缓存保留（pre 31.9% / post 28.3%），story 0%（反代无缓存）；0 warning / 0 截断。报告 `v221-hybrid-3.json`，详见 `test-runs/v22-validation.md` §11 与复审包 07 的 H 组。

### 8.2 T3 story 阶段级自动重试

- **背景**：gemini 单回合可能跑 117 秒，整轮重跑代价过高且会重抽随机事件；而 story 的中断（流式截断 / 反代把审核错误当正文 / `length` / `content_filter` / 网络瞬时错误）多数重试一次即可恢复。
- **实现**：story 内部最多 **2 次尝试**（`STORY_MAX_ATTEMPTS = 2`，首次 + 1 次重试）。重试复用同一份 `storyParams`——brief、三幕窗口、动态世界书、随机事件计划、`beatsThisTurn`、节奏纠偏、`commitId` 与完整提示词都是首次尝试的那一份，因此 **planner_pre 请求数保持 1 次、随机事件不会被重抽、缓存前缀在两次尝试间逐字节一致**。新增 `phase_restart` activity 与 `story_stream_restarted` warning：游戏页收到后清空失败尝试已透出的流式正文与 story 思考（保留 planner 思考），不会把两次尝试拼成正文；失败尝试不写入 `turnRecord`。
- **边界**：用户取消 / 超时 / 认证错误不重试；最多重试一次，内容审核这类稳定拒绝最终仍失败，由整回合自动重试兜底。

### 8.3 测试与验证状态

- T2 新增 11 条（engine 5：混合端点继承 / web_search 只看全局 / reasoning_effort 按端点 / 密钥不外泄等；`tests/settings.test.ts` 6：缺字段与坏值 normalize、分别继承、update/reset 保留与清空）。
- T3 新增 11 条（engine：可重试错误分类、复用 planner_pre、不重抽随机事件、`phase_restart` / `story_stream_restarted`、失败尝试不入 turnRecord、取消 / 认证不重试等）。
- co_author 批次（T7–T12）新增 57 条：四档注入与旧档回退、`soulAndIntent` 边界/坏值、`【SOUL_AND_INTENT】`/`【SOUL_PROFILE】` 注入与缓存前缀、`soulProfile` 落盘/截断/空值不覆盖、零节拍裁剪、随机事件 co_author 冷却与主动跳过、导出 meta。
- 当前全量 **661 条 / 24 个测试文件**，e2e **44 条**，build / patch 全绿。
- **T4 真实链路验证已完成**（2026-10-21，A/B/C/D/E/F/G/H 八组）：数据见 §7.5 与 `test-runs/v22-validation.md`；给 gemini-4-argon 的增量复审材料见 `docs/temp/gemini-4-argon-review/07-v2.2.1-validation-and-next-review.md`。caveat 保持不变：固定输入 / 单次采样 / gemini 反代无缓存。
- **T12 co_author A/B 已完成**（2026-10-22，见 §9.4）：10 回合 10/10、p50 1520 字、5/10 零节拍、P0 14 项 13 ✅ + T4 ⚠️；材料见 §9 与复审包 `08-coauthor-design-and-validation.md`。

## 9. 灵魂共创模式（co_author，v0.7.0）

> 来源：玩家 10 回合真实存档（《错位青春》standard 存档）+ `docs/temp/gemini-回传3.txt`（gemini-4-argon 第三轮专项复审）+ `docs/temp/co-creation-mode-plan.md`。目标：把「planner 拿任务表催进度」改成「先读懂玩家给主角注入的灵魂，顺着玩家的戏演，再顺势嫁接大纲节拍」。

### 9.1 真实存档暴露的 5 个深层问题（复审结论，已逐条核对存档）

1. **T1 剥夺玩家抗争权**：玩家「继续装死」，planner 为一步完成 `beat-toilet-crisis` 替主角祈祷「让我变成女的算了吧」并自动完成变身，没给玩家留「门开一条缝、是否变身」的呼吸口。
2. **T7/T10 硬切与尾盘塞活**：为完成 `beat-new-connection`，在玩家「深藏功与名漫步」时塞高马尾女生查户口；T10 玩家已「溜了」仍在紫藤长廊刷新 NPC。
3. **T8 防御性文本**：planner 把「非查户口/无侵犯感」的负向约束写进 `writingBrief` 括号，story 把它泄漏成正文免责声明「没有男生那种黏糊糊打量外貌的灼热视线，也没有任何居高临下的盘问……」。
4. **T8/T9 违背世界书编造 debuff**：玩家冷幽默「跑饿了去吃什么」被写成异能高频外释导致的低血糖/体力透支反噬——世界书明确「无冷却、无次数上限、无副作用、无 buff/debuff」。
5. **主角灵魂空白 / 镜头洗白**：权威状态只记录客观事件，不记录玩家把主角演成的「腹黑乐子人/愉悦犯」，每回合回到「受惊小白兔」出厂设置；T4「传送室」蒙太奇被洗成写实通勤，T6 保洁阿姨 POV 被压成过场。

### 9.2 产品决策与数据协议

- **不新增第 5 个开关轴**：`storyAutonomy` 扩为四档 `strict / co_author / standard / free`，与 `narrativePace`（镜头）、`inputPerspective`（玩家/导演）、`mode`（执笔/游历）保持正交。
- **默认值**：新旅程默认 `co_author`（`DEFAULT_STORY_AUTONOMY`）；旧存档与缺字段/非法值 hydrate 回退 `standard`（白名单含 co_author），历史存档行为不变。
- **`soulAndIntent`（planner_pre 输出，仅 co_author 必填）**：`protagonistSoul`（≤120 字）/ `playerIntent`（≤120）/ `toneRegister`（≤40）/ `avoidTriggers`（≤100）；解析端逐字段去空白、压单行、截断，坏值/缺失退化为空串，不报错。
- **`soulProfile`（持久化，≤120 字）**：`GameStateV2.soulProfile?: string`（旧档缺省空串）+ `TurnPatchV2.soulProfile?`；`commitTurnPatchV2` 只在非空时覆盖旧值（无变化留空=保持），store hydrate 再压一次单行并截断，防止手改档注入多行文本。
- **零节拍**：`normalizeBeatsThisTurn` 的 co_author 上限为 1 且允许 `[]`；strict 仍 0~1、standard 1 条（无随机事件最多 2）、free 1~3。0 节拍回合合法，patch/paceGuard 不卡幕、不强制补事件、不触发纠偏。
- **随机事件解耦（T9）**：co_author 下随机事件从「节拍补完工具」改为「情境催化剂」——冷却由存档区间夹到 **3~5 回合**；planner 可显式 `randomEvent.planned=false` 主动跳过（不写 history、不 pending 每回合重试，只顺延一个冷却窗口，activeBinding 保留）；禁止为激活不在当前场景的 pending 节拍空投跨场景事件；允许绑定 relationship / 当前线程 / 旧 hook；切幕平滑只拉近到冷却下界、不下穿冷却窗口。
- **导出 meta（T11）**：备份信封新增可选 `meta{version, settings 快照, outlineId, backgroundId, finalStateSummary{act, actIndex, completion, soulProfile, beats}}`；只服务离线复盘，设置快照不含 API Key，story 独立连接只记 `storyApiBaseOverridden/storyApiKeyOverridden` 布尔；导入端不依赖 meta，旧信封无 meta 仍可导入。

### 9.3 提示词核心

- **`【STORY_AUTONOMY】` co_author 文案**（planner_pre 与 story 共用）：① 读懂并顺延主角灵魂（最高优先级，80% 以上笔墨顺延玩家情绪流/分镜/行动惯性，NPC 与世界要鲜活反应，不得变木头人）；② 严禁代写底牌与曲解玩笑（是否发动能力/妥协/祈祷/重大决定留给玩家；生活化吐槽按轻松语调承接，禁止编造低血糖等反噬）；③ 节拍顺势嫁接与零节拍许可（0~1 个，玩家离场/独处/收尾时输出 `[]` 且 `planned=false`，禁止换地图强塞新 NPC）；④ 自然篇幅与余韵停笔（目标 800~1200 字，停笔于玩家动作余波，禁止防御性免责文本）。
- **planner_pre co_author 专属规则**（仅 co_author 追加，其它档提示词不变）：先把玩家的戏读懂演爽（`soulAndIntent` 提炼）、允许零节拍、`writingBrief` 70% 顺承 + 30% 环境反馈且禁写防御性括号、`stopBoundary` 停在余波/幕后反响、尊重 POV 与分割线分镜、语调承接且世界书优先。
- **story 硬规则**：主角意志归玩家（只写外部压迫、生理感官与 NPC 反应）、禁止「没有 A 也没有 B」防御性句式、语调同频且世界书硬设定优先（禁止自行发明 debuff）、尊重玩家镜头权、外部世界必须鲜活。
- **注入位置（缓存安全）**：story user#2 在 `【writingBrief】` 之后注入 `【SOUL_AND_INTENT】主角灵魂画像：…｜本轮延伸意图：…｜语调基准：…｜避雷边界：…`；在 `【AUTHORITATIVE_STATE】` 之后注入 `【SOUL_PROFILE】主角灵魂画像：…`（planner_pre / planner_post 的同位置也有，仅非空时注入）。全部落在可变区 user#2，`system` 与 `【STABLE_STORY_CONTEXT】` 逐字节不变（有回归测试断言）。

### 9.4 T12 A/B 验收（2026-10-22，baseline `776bb52`）

- 运行：gemini-3.8-flash-high × 错位青春 × co_author，玩家真实 10 条输入（与原 standard 存档逐字节一致），**10/10 回合、31/31 请求 HTTP 200、总 20.2 min**；T7 一次 story 截断由 T3 阶段级重试救回（30 正常 + 1 重试，未整回合重跑）。
- **P0 验收 14 项：13 ✅ + 1 ⚠️**（验收回合 T4 基本达标）。关键项：T1 0 祈祷/0 变身，停在「门板被扳开一条指头宽的缝隙」；T2 才由玩家输入自带变身；T6 保洁阿姨 POV 47.5%（原 standard 33%），保留独立半场喜剧；T8 明写「倒不是能力有什么消耗」、0 强制舍友催饭；T10 0 紫藤长廊/0 新 NPC/0 防御文本，交接长在 404 群聊；5/10 回合 `beatsThisTurn=[]`；随机事件冷却 3 回合、T8 到期待发时 planner 主动跳过；soulProfile 10/10 非空、6 次更新；旧档 standard 3 回合回归行为未变（T1 仍祈祷+自动变身、beats 非空、随机事件按旧区间触发）。
- **统计对比（vs 原始 standard 存档，单次采样）**：字数 1494/1658/1628/1249/1384/1478/1516/1520/1861/1683（min 1249 / p50 **1520** / p90 1861 / max **1861** / mean **1547**），比 standard mean 1187 约 **+30%**；pacing 全干净（0 升华收尾 / 0 时间跳跃≥3 / 0 超 5000 字 / needsCorrection=0）；延迟 mean **121s**；切幕 1 次（T4 进入第二幕），终态 2/5、完成度 27%；随机事件 2 计划 / 2 触发 / 1 跳过 / 0 interrupted。
- **篇幅上移的解读**：co_author 要求完整呈现玩家分镜与灵魂延伸（T4/T6/T8/T10 均显著变长），属预期内；`【STORY_AUTONOMY】` 仍是篇幅唯一来源（co_author 文案目标 800~1200 字），但模型对软目标系统性偏长，与 §7.5 standard 漂移同源，不是链路错误。
- **五段原文对照**：T1 危机临界点 vs 原版祈祷变身；T4 一句「脚底像踩了弹簧」的通勤压缩 vs 原版 739 字写实通勤；T6 阿姨 702/1478 字独立半场 vs 原版 322/966 过场；T8 0 反噬 + 干饭纠结 vs 原版低血糖 + 催饭语音；T10 群聊炸锅收尾 vs 原版紫藤长廊新 NPC。完整原文与 JSON 行号见 `test-runs/v07-coauthor-validation.md` §3。

### 9.5 剩余项 / 已知边界

1. **T4「传送室」未按超现实字面演出**（⚠️ 基本达标）：只做到轻快压缩。若要把玩家明示的幻想/超现实转场按字面兑现，建议在 story 可变区加一条「玩家明示的幻想转场按其字面呈现，不自行写实化」——0.7.1 候选。
2. **T8 NPC 误诊台词**：路人台词含「低血糖」字样，属视角猜测、正文明确否认能力消耗；可保留，也可在文案层换词（非必须）。
3. **standard 档篇幅漂移**：§7.5 已记录的 known issue 延续到 0.7.0（standard 目标 800~1100、硬上限 1200，但 A 组 13/20 >1200），co_author 的 +30% 属另一条预期曲线；后续可评估「超出目标带 → 下轮收紧」软纠偏。
4. **co_author 仍依赖模型自觉**：零节拍与「不代写决定」依赖 planner 判断；建议后续观察 soulProfile 是否漂移/膨胀（上限 120 字、只在变化时更新，测试已钉住非空才覆盖）。
5. **caveat**：单次采样（A/B 各 1 次 10 回合/3 回合）、固定输入、gemini 反代无前缀缓存（`cacheHit=0`）；原始 standard 为 2026-10-21 存档、co_author 为 10-22 新状态，字数/细节差异不能全部归因于模式切换。
6. **profile 手动覆盖**仍未做（按 story 模型名自动选择 compact/expressive）；co_author 与 profile 正交，可后续观察。
