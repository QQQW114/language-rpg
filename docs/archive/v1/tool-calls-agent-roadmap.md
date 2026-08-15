# Tool Calls 与 Agent 化路线

目标：保持纯前端架构，在不把全部 JSON / 背包 / 天气 / NPC / 主弧 / 历史一次性塞给模型的前提下，让关键模型按需读取信息，降低成本并提高职责清晰度。

## 设计原则

1. **先只读，后写入**：第一阶段工具只允许读取卷宗、状态、世界书、模型记录；不允许模型直接改状态。
2. **调度优先**：先让“回合司辰”决定调用哪些模型，再逐步让导演 / 审校等复杂模型用工具取信息。
3. **故事模型可读工具**：故事模型保持正文生成者，但允许在流式正文前调用只读工具查大纲、开局、司书库和回合卷宗；工具事件由前端单独显示，不混入正文。
4. **决策模型谨慎上工具**：决策模型每回合都调用，工具会增加延迟；优先保持固定输入。
5. **工具返回短文本**：工具不要返回全量对象，优先返回短摘要 / 指定回合 / 指定模型输出。

## 分阶段路线

### Phase A：无工具版回合司辰

每轮玩家输入后，调用轻量 JSON 模型判断哪些模型需要介入。

司辰只判断“是否调用”，不负责：

- 写故事
- 识别详细玩家意图
- 生成记忆候选
- 编写导演计划
- 生成世界书

### Phase B：回合司辰接入只读工具

推荐工具：

| 工具 | 用途 |
|---|---|
| `get_recent_rounds(n)` | 获取最近 n 回合玩家输入与故事摘要 |
| `get_recent_agent_calls(n)` | 获取最近 n 次模型调用链 |
| `get_agent_output(callId)` | 查看某次模型输出 |
| `get_current_state()` | 获取 NPC / 背包 / 场景 / 当前回合短摘要 |
| `get_recent_history(n)` | 读取当前浏览器态最近 n 条对话，弥补卷宗尚未同步时的信息缺口 |
| `get_story_briefing(round)` | 一次读取完整大纲、开局文本、详细大纲、故事风格、主弧、导演计划、活跃事件 |
| `get_story_outline()` | 读取完整原始故事大纲与 acts |
| `get_detailed_outline(round)` | 读取严格自定义 / 执笔模式详细大纲及目标回合命中项 |
| `get_initial_scene()` | 读取开局文本 / startScene |
| `get_background()` | 读取出身与初始角色设定 |
| `get_world_books(includeEntries)` | 读取当前挂载世界书摘要或条目正文 |
| `get_journey_content()` | 读取旅程创建时固化的内容配置 |
| `get_author_custom_config()` | 读取执笔 / 严格自定义规则与提示词覆盖状态 |
| `get_story_style()` | 读取旅程固化的故事长度与风格偏好 |
| `get_master_arc()` | 获取当前主弧与阶段状态 |
| `get_director_plan()` | 获取当前导演计划 |
| `get_active_events()` | 获取正在进行的长线事件 |

### Phase C：导演 / 逻辑审校 / 故事模型接入工具

优先对象：

- 叙事导演：按需读取主弧、最近回合、事件弧、阶段判断。
- 逻辑审校：按需查证 NPC、道具、场景、承诺、旧模型输出。
- 故事模型：按需读取完整大纲、详细大纲、开局文本、司书库文件和近期回合；最终只输出故事正文。

### Phase D：再考虑写入工具

写入工具会影响回溯和状态一致性，暂缓。未来可考虑：

- `suggest_anchor`
- `request_memory_update`
- `request_setting_guard`

所有写入工具必须经过 store action，并被回合卷宗记录。

## DeepSeek Tool Calls 注意事项

- 模型返回 tool calls，前端执行工具后再把工具结果发回模型。
- reasoning 模型如果返回 `reasoning_content`，下一轮 assistant 消息要原样带回，否则 DeepSeek 会报 400。
- strict 模式需要 `/beta` base URL，并对 JSON Schema 有额外限制。
- 第一版不启用 strict tool calls，先以普通 JSON 调度模型落地。

## 当前补强点

- seed 镜像已补充 `director/opening.md`、`director/detailed-outline.md`、`director/custom-rules.md`、`director/current-plan.md`、`world/setting-guard.md`、`audits/logic-review.md`、`timeline/active-events.md` 等关键文件。
- `get_story_briefing` 是处理“回忆开局 / 补写跳过关键事件 / 核对大纲因果”的优先工具。
- 故事模型已接入只读 tool calls：写正文前可按需读取司书库 manifest 对应文件、故事资料包、完整大纲、详细大纲、开局文本、世界书、主弧、导演计划和活跃事件。
- 前端会把故事模型工具调用记录为独立活动，例如“故事写手查阅了完整故事大纲”“阅读了 xxx”，不混入正文。
- 回合司辰、叙事导演、动态随机事件、设定守护、阶段判断、逻辑审校等模型也已可接入同一套只读工具运行时；但“司辰多轮工具调用后再动态调用其他模型”的上层闭环尚未完成。
- 当前仍不开放写入工具。司书库写入必须等回溯、冲突检测、回合卷宗记录与 store action 边界进一步稳定后再做。

## 当前与故事 Agent 重构的关系

工具链现在服务于两个目标：

1. **降低模型一次性输入负担**：不再把所有历史和文件全部塞进 prompt，而是给 manifest，让模型按需读取。
2. **解决复杂回溯/补写问题**：当玩家要求回忆开局、补写跳过关键事件、核对能力起因或世界机制时，模型可调用 `get_story_briefing`、`get_initial_scene`、`get_story_outline` 等工具查证。

与 `docs/story-agent-architecture-plan.md` 对应：

- 回合司辰目前输出 `calls + callOrder`，程序按计划调用模型。
- 大纲映射 / 人物规划 / 场景规划 / 事件规划已拆为独立只读工具可用的规划模型，结果分别写入 `authorNarrative.outlineMapping / characterPlan / scenePlan / eventPlan`，再由叙事导演整合为 `writingBrief`。
- 后续若升级为“司辰主动多轮工具调用”，本文件的 Phase B / C 将成为实现依据。

参考：DeepSeek Tool Calls 文档  
https://api-docs.deepseek.com/zh-cn/guides/tool_calls
