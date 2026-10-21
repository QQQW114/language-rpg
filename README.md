# 言灵 · Language RPG v0.6.0

纯前端、双模型驱动的中文互动小说 AGENT。

> **在线体验**：<https://qqqw114.github.io/language-rpg/>（纯前端、无后端；首次使用请先到「模型与连接设置」填入自己的 API Base URL、API Key 与模型名。内置 3 个预设故事：《错位青春》《余温代行人》《赝品修复师》。）

## 核心架构

故事以轮为单位，每轮使用两种模型：

1. **规划 Agent**：读取程序侧权威状态，完成写前规划；故事生成后延续同一会话，提交人物、关系、物品、任务和场景变化 Patch。
2. **故事 Agent**：根据 规划Agent安排 生成小说正文。

状态写入程序校验，模型不修改数据库或资料文件。

两个模型可以走不同的 API 端点：设置里「故事模型独立连接（可选）」支持给故事阶段单独填 API Base URL / API Key，留空则分别继承全局连接。典型用法是规划与结算走官方 DeepSeek（缓存与 JSON 更稳），故事走 Gemini 等更强的模型。规划与结算始终使用全局连接，联网搜索也只认全局端点。

## 模式

- **执笔模式**：固定无限回合，每轮由玩家自由输入，不使用选项刷新、回合上限或旧角色模型。
- **游历模式**：复用同一个回合引擎，规划 Agent 在写后生成 2～4 个行动选项，同时仍允许自由输入。

## 亮点
- **自由度**：可自由输入故事安排，完全由Agent推进故事。
- **故事主线**：重演世界书设定故事，由Agent驱动的故事进度推进与随机事件。
- **幕系统**：当前幕由程序权威维护（模型自报乱报会被忽略）；本幕故事节完成后自动进入下一幕，玩家改道时可通过挂账 gate 携节跨幕，挂账节不视为完成、不放宽结局门槛。
- **随机事件钩子**：每个随机事件都必须绑定故事节 / 线程 / 关系 / 最终命运之一，并带滚动历史与三态结算（兑现 / 留钩子 / 被打断），后续回合可以回收之前埋下的钩子。
- **上下文检索**：规划模型可按需检索旧正文、人物、关系、正史事实与故事线程；先整串命中再按关键词覆盖率排序，返回结果带命中词与评分，证据附命中位置而不是一段无关开头。
- **可选联网搜索**：默认关闭，仅在官方 DeepSeek 地址 + API Key 且玩家显式开启时生效；只用于现实世界事实（制度、地理、机构、专业知识），虚构设定、世界书与正史始终优先，外部结果不得覆盖既有设定。
- **节奏纠偏**：程序检测升华式收尾、单轮时间跨度与篇幅超预算，只对下一轮做软纠偏，不改写或回滚已生成的正文。
- **长文阅读导航**：卷宗目录与回合跳转、存档级书签、字号 / 行距 / 版心调节、跨幕题跋与「回到最新」。
- **故事工坊**：自行编写幕、故事节和世界书；内容保存在浏览器，可用 JSON 导入导出。
- **存档备份**：主页「继续旅程」支持把存档导出为 JSON 备份、从备份导入（导入一律作为新旅程，不覆盖现有存档）。
- **失败恢复**：写后结算失败时正文与写前规划都会保留，可只重试结算，不必重跑整轮。
- **便捷开发**：已附带测试工具与Agent文档，可快速接手并开发。

## 故事工坊

主页或启程页可进入“故事工坊”：

- 创建、编辑和删除自定义故事；
- 编排多幕结构及每幕必须实现的故事节；
- 为故事关联一部或多部自定义世界书；
- 设置世界书条目的关键词、优先级与常驻注入；
- 复制内置预设故事作为只读范本的可编辑副本（内置《错位青春》《余温代行人》《赝品修复师》）；
- 内置故事自带推荐主角出身（曦宇 / 林澈 / 苏砚），启程页会按故事过滤出身；
- 导入或导出单个故事以及完整内容库 JSON。

自定义内容保存在 `lrpg.content` 浏览器存储中。清理站点数据或更换浏览器前，请先导出备份。

## 数据

V2 使用独立浏览器存储 `lrpg.v2`，不兼容0.3版本以下的旧存档。

> 当前发行版：**0.6.0**（Prompt Pack v2.2.1：故事推进权限 / 文风 profile / 失败恢复 / 混合端点 / 阶段级重试）。详见 [`CHANGELOG.md`](CHANGELOG.md) 与 [`docs/release-notes-v0.6.0.md`](docs/release-notes-v0.6.0.md)。

存档可在主页「继续旅程」中随时导出为 JSON 备份，也可从备份导入恢复；导入一律生成新旅程，不会覆盖现有存档。

权威状态包括：

- 人物与已知事实
- 人物关系与好感
- 库存数量与类型
- 故事线程 / 任务
- 当前场景
- 命运进度：当前幕（程序权威）、幕历史、故事节状态（含跨幕挂账标记）
- 随机事件：档位、待兑现绑定与滚动钩子历史
- 故事摘要与最新进度

世界书作为创建旅程时选择的可检索事实资料，不驱动独立设定守护或多 Agent 链。

## 启动

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 测试

单元测试（离线运行，模型调用全部 mock）：

```bash
npm test
```

Patch / 命运状态回归：

```bash
npm run test:patch
```

故事链路脚本测试（未配置 API 时自动进入 dry-run）：

```bash
npm run test:story -- --dry-run --mode=author
npm run test:story -- --dry-run --mode=adventure
```

真实模型测试：

```bash
LRPG_API_BASE=https://your-api.example/v1
LRPG_API_KEY=your-key
LRPG_PLANNER_MODEL=planner-model
LRPG_STORY_MODEL=story-model
npm run test:story -- --mode=author
```

可使用 `--inputs=inputs.txt` 提供每行一条玩家输入，测试报告保存到被 Git 忽略的 `test-runs/`。

真实链路冒烟（用真实 engine/store 打真实 API，跑 1~40 回合并检查落盘与缓存命中；未配置环境变量时直接退出）：

```bash
LRPG_API_BASE=https://api.deepseek.com/v1
LRPG_API_KEY=your-key
LRPG_MODEL=deepseek-flash
LRPG_TURNS=3
npm run test:real
```

可选环境变量：

- `LRPG_TURNS`（1~40，默认 2）、`LRPG_MAX_TOKENS`（`0` 表示不限输出，默认 `0`）、`LRPG_RETRIES`；
- `LRPG_OUTLINE_ID`：选择一个内置预设故事（自动带上其推荐出身与世界书）；
- `LRPG_REPORT_FILE`：自定义报告路径（并行跑多个预设时分开写，互不覆盖）；
- `LRPG_CHECKPOINT_FILE`：检查点路径（默认 `test-runs/real-chain-checkpoint.json`，每回合成功后写完整存档快照）；
- `LRPG_RESUME`：指向检查点文件，从最后一个成功回合继续跑（不再从头重来）；
- `LRPG_TURN_TIMEOUT_MS`：单回合超时毫秒（默认 `480000`；反代挂死时中止并按可重试错误处理）；
- `LRPG_INPUTS_FILE`：外部输入列表，每行一条玩家输入（空行与 `#` 开头忽略）；
- `LRPG_TOOLS=1`：启用规划模型上下文检索工具；
- `LRPG_WEB_SEARCH=1`：启用官方 DeepSeek 联网搜索（仅官方 API Base 生效；查询会发给 DeepSeek，按成功请求计费）。

报告写入 `test-runs/real-chain-report.json`，含逐回合分阶段缓存命中、`cacheSummary`（预热回合命中率）与长局 `evaluation`（篇幅分布、升华收尾 / 时间跳跃 / 超预算次数、随机事件三态、幕切换、token 合计）。脚本内置了针对网关门禁、429 与 5xx 的请求级重试。

## 开发文档

- [`AGENTS.md`](AGENTS.md)：接手约定——运行命令、代码结构、路由、浏览器存储键、开发注意事项。
- [`PROJECT_HANDOFF.md`](PROJECT_HANDOFF.md)：接手记录与仍需人工完成的事项。
- [`docs/destiny-driven-story-core.md`](docs/destiny-driven-story-core.md)：产品定位与最高设计约束，改提示词前必读。
- [`docs/act-system-plan.md`](docs/act-system-plan.md)：幕系统改造的决议记录与实施计划（D1–D10、P1–P6 步骤、验收口径）。
- [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)：与代码同步的实现状态（协议字段、状态结构、测试体系）。
- [`docs/prompt-list.md`](docs/prompt-list.md)：当前提示词结构（Prompt Pack v2.1）。
- [`docs/prompt-design-log.md`](docs/prompt-design-log.md)：提示词评审结论、A/B 数据、过拟合审计与模型分级建议。
- [`docs/preset-authoring.md`](docs/preset-authoring.md)：预设故事 / 世界书 / 出身的编写规范与导入格式。
- [`CHANGELOG.md`](CHANGELOG.md)：版本更新记录。
- [`docs/release-notes-v0.6.0.md`](docs/release-notes-v0.6.0.md)：当前发行版说明。

## 技术栈

Vite + React 18 + TypeScript + Zustand + Tailwind CSS。

License: GPL-3.0。

## 开发工具
V1: codex+gpt5.5
V2: codex+gpt5.6 sol
