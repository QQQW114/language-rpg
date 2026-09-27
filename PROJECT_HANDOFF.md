# Language RPG 项目接手记录

本文件记录**当前**接手状态与验证结论。若与代码冲突，以代码与 `docs/PROJECT_STATUS.md` 为准。

## 一、项目概览

`language-rpg`（言灵 · Language RPG）v0.3.0：纯前端、双模型驱动的中文互动小说。

- 玩家创建旅程后，由**规划模型**（写前规划 + 写后结算）与**故事模型**（正文）协作推进回合。
- 权威状态（人物、关系、库存、线程、事实、场景、命运、随机事件）由程序侧 `patch.ts` 校验与提交，模型只输出增量。
- 无后端：数据全部存于浏览器本地存储。

完整结构与约定见 [`../AGENTS.md`](../AGENTS.md)，实现状态见 [`PROJECT_STATUS.md`](PROJECT_STATUS.md)，产品约束见 [`destiny-driven-story-core.md`](destiny-driven-story-core.md)。

## 二、接手时发现的问题与处理

接手时项目存在三类问题，已在本次接手改造中处理：

| 问题 | 具体表现 | 处理 |
|---|---|---|
| 文档严重脱节 | `AGENTS.md` 描述的是 V1 结构：`src/store/useGameStore.ts`、`src/services/storyAgent.ts`、`src/prompts/*` 等**文件均不存在**；存储键写成 `lrpg.games` / `lrpg.settings`（实际是 `lrpg.v2` / `lrpg.settings.v2`）；要求跟踪的 `runStory` / `runChoices` / `dispatch` 三个函数也不存在 | 重写 `AGENTS.md` 与本文；`PROJECT_STATUS.md`、`docs/README.md` 同步校正 |
| 大量 V1 死代码 | 37 个文件零引用（旧组件、`LibraryPage`、`GamePage.tsx.bak`、IndexedDB 司书库、工作区模板链路等），且 `src/types/game.ts` 已被删除却仍被十余个文件 import | 全量删除，并同步裁剪 `contentLibrary` / `useContentStore` / `types/content` / `types/ledger` 的废弃字段 |
| 类型检查形同虚设 | `tsconfig.json` 的 `include` 只列了 4 个路径，死代码长期不在检查范围内，因此腐坏无人发现 | include 改为 `["src"]`，修复后 `npx tsc --noEmit` 零错误 |
| 无自动化测试 | 只有两个手写 node 脚本，核心纯函数无回归网 | 建立 esbuild + `node:test` 测试系统，覆盖工具、SSE、Patch、引擎、存档、内容库与工坊校验 |

## 三、本次改造的验证记录

| 验证项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `cmd /c npx tsc --noEmit` | 通过（全 `src/` 零错误） |
| 生产构建 | `cmd /c npm run build` | 通过 |
| 单元测试 | `cmd /c npm test` | 通过 |
| Patch 回归 | `cmd /c npm run test:patch` | 通过 |
| 故事链路（无 Key） | `cmd /c npm run test:story -- --dry-run` | 通过 |
| 开发服务器 | `cmd /c npm run dev` | `http://127.0.0.1:5173` 正常响应并转译模块 |

清理效果：源文件 74 → 41 个；Tailwind 产物 CSS 58.3 → 45.9 kB（不再扫描死代码）；JS 主包 532 → 524 kB（gzip 178 → 172 kB）。

## 四、仍需人工完成的事项

1. **模型链路冒烟测试**：本机无 API Key，未做真实模型调用。配置 API 后需手动走一遍：设置 → 启程 → 生成一轮 → 生成选项 → 背包 / 场景跳转 / 手动输入 / 完结评分。
2. **浏览器交互级回归**：本次改造未改动运行时行为（只删除零引用文件与废弃字段），但仍建议人工点一遍 `/`、`/setup`、`/game`、`/workshop`、`/settings` 五条路由。
3. **遗留资产决策**：
   - `.legacy-reference/`（V1 提示词与架构草稿，已 gitignore、不参与构建）确认无用后可删除；
   - `test-saves/`、`test-runs/`（均已 gitignore）为历史测试产物，可按需保留或清理。
4. **包体积**：主包仍有 500 kB 级 chunk 警告。若需要，可对 `/workshop` 与 `react-markdown` 做动态 import 分包（本次未做，避免影响现有行为）。
5. **存档兼容**：`useContentStore` 持久化版本已升至 3，旧数据中的 `customEvents` / `customWorkspaceTemplates` 会被静默丢弃；V2 存档本就不兼容 0.3 以下版本。
