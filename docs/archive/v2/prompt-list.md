# 当前提示词架构

本项目已从多 Agent 执笔链迁移到双模型回合：

```text
规划 Agent（写前） → 故事 Agent → 规划 Agent（写后结算）
```

当前唯一维护的核心提示词是：

- `src/prompts/plannerSystem.ts`：规划 Agent 的写前/写后协议与检索纪律。
- `src/prompts/storySystem.ts`：故事 Agent 的正文规则。

## 规划 Agent

规划 Agent 在同一回合内保留会话上下文。写前输出 `writingBrief`，写后读取实际正文并输出结构化状态变化：人物、好感、背包、场景、选项和进度摘要。

它可以调用三个只读上下文工具：

- `get_story_context`
- `search_story_context`
- `read_story_context`

工具只用于查证。已有最新状态足够时不得搜索；通常最多一轮搜索加一轮精确读取。任何状态写入都由程序侧校验并提交，Agent 不得写司书库或数据库。

## 故事 Agent

故事 Agent 只负责正文表达，接收规划 Agent 的写作简报、事实约束和停止边界。它不得替玩家完成未授权重大选择，也不承担状态维护。

## 旧提示词

旧版司辰、阶段判断、设定守护、导演、事件规划和逻辑审校提示词已移至本地 Git 忽略目录 `.legacy-reference/prompts/`，仅供迁移参考，不属于当前产品架构，也不会随仓库提交。

详见：[`dual-model-agent-architecture.md`](dual-model-agent-architecture.md)。
