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
| 文档严重脱节 | 旧 `AGENTS.md` 描述的是 V1 结构：`src/store/useGameStore.ts`、`src/services/storyAgent.ts`、`src/prompts/*` 等**文件均不存在**；要求跟踪的 `runStory` / `runChoices` / `dispatch` 三个函数也不存在。存储键写成 `lrpg.games` / `lrpg.settings`（实际是 `lrpg.v2` / `lrpg.settings.v2`）——这条错误出自旧版 `PROJECT_HANDOFF.md`，`AGENTS.md` 未提及存储键 | 重写 `AGENTS.md` 与本文；`PROJECT_STATUS.md`、`docs/README.md` 同步校正 |
| 大量 V1 死代码 | 36 个**被 git 跟踪**的零引用文件（旧组件、`LibraryPage`、IndexedDB 司书库、工作区模板链路等），另有 1 个从未纳入 git 的 `src/pages/GamePage.tsx.bak`；且 `src/types/game.ts` 已被删除却仍被十余个文件 import | 全部删除（共 37 个文件），并同步裁剪 `contentLibrary` / `useContentStore` / `types/content` / `types/ledger` 的废弃字段 |
| 类型检查形同虚设 | `tsconfig.json` 的 `include` 只列了 4 个路径，死代码长期不在检查范围内，因此腐坏无人发现 | include 改为 `["src"]`，修复后 `npx tsc --noEmit` 零错误 |
| 无自动化测试 | 只有两个手写 node 脚本，核心纯函数无回归网 | 建立 esbuild + `node:test` 测试系统（242 条用例），覆盖工具、SSE、Patch、引擎、存档、内容库与工坊校验 |
| 两处核心 bug | ① `extractJSONText` 贪婪匹配：模型在 JSON 后继续输出文字或返回多个对象时整体解析失败返回 `null`，导致 `runTurnV2` 抛错、整回合失败；② `mergeLlmUsage` 用 `undefined` 覆盖已拿到的缓存命中统计 | 均已修复并补回归测试（详见 [`docs/known-issues.md`](docs/known-issues.md) 文末） |

## 三、本次改造的验证记录

| 验证项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `cmd /c npx tsc --noEmit` | 通过（全 `src/` 40 个文件零错误） |
| 生产构建 | `cmd /c npm run build` | 通过（1868 modules，5.6s） |
| 单元测试 | `cmd /c npm test` | 通过（242 条用例） |
| Patch 回归 | `cmd /c npm run test:patch` | 通过 |
| 故事链路（无 Key） | `cmd /c npm run test:story -- --dry-run` | 通过 |
| 开发服务器 | `cmd /c npm run dev` | `http://127.0.0.1:5173` 正常响应并转译模块 |
| 独立复核 | 由另一名 agent 做对抗式复核 | 未发现阻断性问题；发现并已修复 3 个非阻断缺陷（见下） |

清理效果（同一条 `npm run build` 口径对比）：

| 指标 | 清理前 | 清理后 |
|---|---|---|
| `src/` 文件数（git 跟踪） | 77 | 41 |
| JS 主包 | 548.66 kB | 524.59 kB |
| JS gzip | 178.00 kB | 172.63 kB |
| CSS | 58.28 kB | 45.94 kB |
| CSS gzip | 11.35 kB | 9.25 kB |

> JS 体积只降 4%，因为被删文件本就未被任何页面 import（rollup 早已 tree-shake）。CSS 降 21% 是真实收益：Tailwind 不再扫描死代码里的类名。

复核发现并已修复的 4 个缺陷（均已补回归测试）：

1. `extractJSONText` 在**截断输入**上会返回内层对象（`{"a":{"b":1}` → `{"b":1}`），把"解析失败"变成"误导性结果"；现在返回 `null`。
2. `extractJSONText` 存在**平方级性能悬崖**：每个 `{` 都白扫到结尾，200 KB 未闭合括号实测 124 秒、会冻结标签页。现在加了 O(1) 预检与"尾部未闭合即停止"判断，**200 万个未闭合括号耗时 2 ms**。
3. 合法 JSON 在前、非法 fence 在后时，fence 剥离会把前面的合法对象一起丢掉；现在先试 fence 内、失败再回退全文。
4. `commitTurnPatchV2` 在补丁缺 `latestProgress` 时会**清空已有进度**（复核用真实 `runTurnV2` 证明在线可达）。新增 `textOrPrevious` 统一语义：空串/空白串视为未提供、保留旧值。注意 `raw || previous` 拦不住 `'   '`（truthy），这个坑也是复核发现的。

## 四、仍需人工完成的事项

1. **模型链路冒烟测试**：本机无 API Key，未做真实模型调用。`scripts/test-production-v2.ts` 是完整的真实模型链路脚本（用当前 `runTurnV2` 跑多回合：慢 / 标准 / 快 / 时间跨越），但它需要 TS 运行时，仓库未安装 tsx/ts-node，可用已装的 esbuild 临时打包后运行：

   ```bash
   cmd /c npx esbuild scripts/test-production-v2.ts --bundle --platform=node --format=esm --outfile=test-runs/production-v2.mjs
   set LRPG_API_KEY=你的Key
   node test-runs/production-v2.mjs
   ```

   浏览器端手动冒烟路径：设置 → 启程 → 生成一轮 → 生成选项 → 背包 / 场景跳转 / 手动输入 / 完结评分。
2. **浏览器交互级回归**：本次改造删除了零引用文件，并修复了两处**位于核心回合链路上**的解析/合并 bug（`extractJSONText`、`mergeLlmUsage`），其余运行时行为未改动。单元测试已覆盖这两处修复与三阶段链路，但仍建议人工点一遍 `/`、`/setup`、`/game`、`/workshop`、`/settings` 五条路由。
3. **遗留资产决策**：
   - `.legacy-reference/`（V1 提示词与架构草稿，已 gitignore、不参与构建）确认无用后可删除；
   - `test-saves/`、`test-runs/`（均已 gitignore）为历史测试产物，可按需保留或清理；
   - `scripts/test-api.mjs` 是独立的 Responses 格式联调脚本，仍需手动执行（`node scripts/test-api.mjs [model]`），未接入 npm scripts。
4. **包体积**：主包仍有 500 kB 级 chunk 警告。若需要，可对 `/workshop` 与 `react-markdown` 做动态 import 分包（本次未做，避免影响现有行为）。
5. **存档兼容**：`useContentStore` 持久化版本已升至 3，旧数据中的 `customEvents` / `customWorkspaceTemplates` 会被静默丢弃；V2 存档本就不兼容 0.3 以下版本。
