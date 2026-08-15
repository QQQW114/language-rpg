# 双模型重构迁移清单

## 第一阶段：可运行闭环

- [ ] 设置页增加规划模型，旧多 Agent 路由隐藏但兼容读取。
- [ ] 新增规划 Agent 写前/写后 Prompt。
- [ ] 写前返回简洁 `writingBrief`。
- [ ] 写后返回与现有 store action 兼容的状态 Patch。
- [ ] 执笔模式主链切换为 Planner → Story → Planner。
- [ ] 游历模式暂时保持原决策链。

## 第二阶段：上下文工具

- [ ] `get_story_context`
- [ ] `search_story_context`
- [ ] `read_story_context`
- [ ] 禁止 Agent 写司书库。
- [ ] 搜索覆盖回合原文、NPC、物品、事件和人工世界资料。

## 第三阶段：清理

- [ ] 移除 GamePage 旧司辰/规划模型调用。
- [ ] 删除旧 Agent 设置 UI。
- [ ] 将 Workspace 页面改为人工资料和上下文调试页。
- [ ] 删除未再使用的 Prompt/Service/类型。
- [ ] 重写 `prompt-list.md`、`known-issues.md` 与 README 架构说明。

## 验收指标

- 常规执笔回合只出现两种模型。
- 同一规划 Agent 完成写前和写后，写后能看到写前 brief 与最新正文。
- 未变化的人物、物品和事件不会被全量重写。
- 长程问题会主动搜索；普通对话不会盲目多轮搜索。
- Agent 无法直接修改任何司书库或数据库文件。
- 回溯、导出和导入仍能恢复权威状态。
