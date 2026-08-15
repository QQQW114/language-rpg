# 当前提示词清单

当前 V2 提示词全部内嵌在 `src/v2/engine.ts`，没有独立的 `src/prompts/` 目录。

## 三个模型与提示词函数

| 模型 | 阶段 | 提示词构造 | 说明 |
|---|---|---|---|
| 规划模型 | 写前规划 | `buildPlannerPreSystem(director)` | 输出本回合写作约束 JSON |
| 故事模型 | 正文写作 | `buildStorySystem(director)` | 只输出中文小说正文 |
| 规划模型 | 写后结算 | `buildPlannerPostSystem(director)` | 输出增量状态 Patch JSON |

## 共享提示词片段

| 片段 | 作用 |
|---|---|
| `plannerPrePlayerAgency` / `plannerPreDirectorAgency` | 写前规划对玩家输入视角的处理 |
| `storyPlayerAgency` / `storyDirectorAgency` | 故事模型对玩家输入视角的处理 |
| `plannerPostDirectorAgency` | 写后结算在导演视角下的额外约束 |
| `plannerToolDiscipline` | 规划模型上下文查询工具纪律 |
| `plannerContextTool` | `search_story_context` 工具定义 |
| `paceInstruction(p)` | 四档叙事速度说明 |
| `randomEventInstruction(p)` | 随机事件到期指令（三档 intensity） |
| `postShape` | 写后结算输出 JSON 模板 |

## 高优先级注入

- 配置：`AppSettings.roleInjects.planner / story / post`；
- 函数：`withRoleInject(baseSystem, inject)`；
- 位置：拼接在对应系统提示词最前方；
- 规划角色每个存档只注入一次（`state.plannerInjectApplied` 标记）。

## 输入视角

- 配置：`AppSettings.inputPerspective = 'player' | 'director'`；
- 只在执笔模式（`mode === 'author'`）下生效；
- 通过 `director` 参数传入上述 `build*System` 函数。
