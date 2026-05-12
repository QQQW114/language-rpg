# 言灵 · Language RPG

一个由大语言模型驱动的纯前端故事 Agent / 中文文字 RPG / 互动小说前端。

玩家选择故事大纲、角色出身、世界书与随机事件后，由多个模型协作推进旅程：

- **故事模型**：根据设定、历史、长期记忆、能力、人物关系、场景、阶段焦点与玩家行动生成正文。
- **决策模型**：根据最新故事提取选项、能力变化、人物关系、场景、时间与天气。
- **回合司辰**（执笔模式 · 每回合调度层）：判断本回合类型、规划深度与模型调用顺序，并可拉起人物 / 场景 / 事件分析工具补足信息。
- **阶段判断模型**：分析玩家最新输入、节奏（沉浸 / 探索 / 推进 / 快进）与当前阶段进度，告诉故事模型本回合该聚焦哪一件微节拍，避免一回合压缩多步。
- **设定守护者**（执笔模式 · 每回合）：故事生成前扫描世界书与玩家输入，给出"必须遵守"的设定补丁、世界书候选、环境侧反应建议、偏离风险预警。
- **主弧模型**（执笔模式 · 创建旅程时）：基于大纲、出身、世界书生成不绑定回合的阶段化主弧，作为故事推进的母锚。
- **叙事导演 / 司事 / 逻辑审校**（执笔模式）：维护 writingBrief、事件弧节奏、连续性与剧情驱动事件。
- **记忆模型**：周期性整理外观、服装、承诺、线索、关系等长期一致性信息（含世界书一致性 + 大纲对齐）。
- **摘要模型**：在历史过长时压缩早期上下文（保留伏笔与关键回收弹药）。

项目是纯前端应用，不依赖后端服务；设置、存档、回合卷宗、模型调用记录与自定义内容默认保存在浏览器本地存储中。

## 主要功能

- 导入或调用模型生成故事大纲、角色出身、世界书、随机事件与开局场景。
- **游历模式**：模型根据世界观生成故事正文和行动选项，玩家通过选择分支推进旅程；可配置每隔若干回合获得一次自由输入机会，支持有限回合与无尽模式。
- **执笔模式**：面向更强自定义与共同写作，默认每回合自由输入；通过阶段化主弧 + 玩家节奏感知 + 设定守护 + 叙事导演 + 逻辑审校等多模型协作维持小说化方向与一致性。
- 支持能力、NPC 好感与细节、场景跳转、时间天气、记忆锚点、聊天记录编辑和重新生成。
- 支持导出聊天记录 Markdown，以及可分享 / 导入的完整旅程卷宗包 ZIP。

## 特色功能

- **阶段化叙事**：故事按"阶段 + 节拍"推进，不绑死回合数。玩家自己控制节奏，模型识别"沉浸 / 探索 / 推进 / 快进"四档自动调整粒度，慢玩家不被追着走。
- **设定守护者**：每回合扫描世界书与玩家输入，捕捉"瞎发挥"风险、给出环境侧主动反应建议、自动累积玩家偏好画像。
- **执笔辅助链路**：
  - 主弧生成（基于大纲 + 世界书）。
  - 叙事弧 / 剧情驱动长线随机事件。
  - 故事生成前置设定守护与玩家意图分析。
  - 环境侧主动反应建议（导员 / 室友 / NPC 等可能主动联系主角）。
  - 玩家偏好画像 + 节奏感知。
  - 逻辑审校与连续性修复建议（按 severity 分级注入）。
  - 随故事推进的世界书候选补充系统（玩家可一键沉淀）。
- 加载状态古风文案：每个模型跑时显示对应文案（"心镜映念 · 揣度此意"、"世书守护 · 查阅设定"等）。
- 高度可自定义的故事流程：严格自定义提示词、执笔模式独立提示词链路。
- 模型辅助生成世界书、出身、剧情大纲、随机事件与开局。
- 随故事更新的场景、世界状态、时间、天气与长期记忆。
- 能力系统与随故事变化的人物关系。

## 快速开始

### Windows

双击：

```bat
start.cmd
```

首次启动会自动执行 `npm install`。

### macOS / Linux

```bash
chmod +x start.sh
./start.sh
```

启动后访问：

```text
http://127.0.0.1:5173
```

## 首次使用

1. 进入「设置」。
2. 填写：
   - API Base URL
   - API Key
   - 请求格式
   - 故事模型
   - 决策模型
3. 按需填写：
   - 摘要模型
   - 长期记忆模型
   - 随机生成模型（执笔辅助模型默认复用此设置）
4. 返回主页，点击「启程 · 开始新旅程」。


## 推荐模型配置

推荐：`deepseek-v4-pro` / `deepseek-v4-flash` 或能力相近的快速高效长上下文模型。

项目制作与维护均使用 deepseek-v4 系列测试，提示词优化方向特化 deepseek-v4 系列。

- **故事模型**：`deepseek-v4-pro` —— 故事生成模型，越强越好。
- **决策模型**：`deepseek-v4-flash` —— 场景轮换、人物关系、能力状态。
- **摘要 / 记忆模型**：`deepseek-v4-flash` —— 压缩上下文 + 整理稳定事实。
- **随机生成模型**：`deepseek-v4-pro` —— 生成世界书、人设、随机事件、主弧；越强越好（这是被多个执笔辅助模型复用的设置）。

## 存档与数据

本项目保持纯前端，未引入后端数据库。当前存档体系以浏览器 IndexedDB 为主，`localStorage` 只保留设置与少量轻状态：

- `lrpg.settings`：模型 API、温度、记忆设置、故事风格等。
- `lrpg.content`：自定义故事大纲、出身、世界书、随机事件。
- `activeSaveId` 等轻量状态：记录当前旅程入口。
- `language-rpg-ledger`（IndexedDB）：保存旅程、分回合卷宗、模型调用记录、快照、聊天记录、能力、NPC、场景、长期记忆、主弧、阶段判断状态等。

如果更换浏览器、清理站点数据或换设备，本地数据可能丢失。建议使用「旅程包」导出重要存档。

> API Key 与对话记录只保存在本地浏览器存储中，不会被项目主动上传到其他地方；模型请求只会发往玩家在设置页配置的 API 地址。

> 注：阶段化叙事架构改动后，**之前版本的执笔旅程包不再兼容**——旧存档没有主弧数据会被识别为"旧版 · 不可继续"。请重新创建旅程。

## 内容导入 / 导出

- 「书库」中可以管理故事大纲、出身、世界书、随机事件。
- 「游戏页」可以导出：
  - 聊天记录 Markdown
  - 完整旅程卷宗包 ZIP
- 「主页」可以导入旅程卷宗包 ZIP。

旅程包不包含 API Key，但会包含当前旅程需要复现的故事设置、书库资源、执笔模式配置、严格自定义配置、主弧 / 阶段判断状态、回合快照、模型调用记录与聊天记录。

## 技术栈

- Vite
- React 18
- TypeScript
- Tailwind CSS
- Zustand
- React Router
- React Markdown

## 本地开发

```bash
npm install
npm run dev
npm run build
npm run preview
```

PowerShell 中如果直接运行 `npm` 被执行策略拦截，可使用：

```bat
cmd /c npm run build
```

## 项目结构

```text
src/
  pages/        页面级流程：主页、启程、游戏、设置、书库
  components/   UI 与游戏面板组件（StoryView / ChoicePanel / MasterArcPanel / SettingGuardPanel / AuthorArcPanel / CharacterPanel 等）
  store/        Zustand 状态、轻状态持久化与回合状态管理
  services/     模型调用与游戏服务
  prompts/      故事、决策、记忆、摘要、评分、执笔辅助等提示词
  presets/      内置故事大纲、出身、世界书、随机事件
  lib/          通用工具、严格自定义、旅程包等
  storage/      IndexedDB 回合卷宗与持久化仓库
  types/        TypeScript 类型定义
```

## agent文档（docs/）

| 文件 | 用途 |
|---|---|
| [`prompt-list.md`](docs/prompt-list.md) | 提示词链路全图（v2，当前真实状态） |
| [`execution-plan.md`](docs/execution-plan.md) | 执笔模式落地计划与 Phase 进度跟踪 |
| [`setting-guard.md`](docs/setting-guard.md) | Phase 1.0 设定守护者实施规范 |
| [`stage-narrative.md`](docs/stage-narrative.md) | Phase 1.0.5 阶段化叙事 + 玩家节奏感知实施规范 |
| [`known-issues.md`](docs/known-issues.md) | 已知问题、风险、待办、watchlist |
| [`round-ledger-storage-plan.md`](docs/round-ledger-storage-plan.md) | IndexedDB 回合卷宗、快照回溯与 ZIP 旅程包方案 |
| [`tool-calls-agent-roadmap.md`](docs/tool-calls-agent-roadmap.md) | Tool Calls 与故事 Agent 工具链路线 |
| [`story-agent-workspace.md`](docs/story-agent-workspace.md) | 司书库 / 故事 Agent 工作区设计 |
| [`story-agent-architecture-plan.md`](docs/story-agent-architecture-plan.md) | 故事 Agent 架构、模型职责与保存链路规划 |
| [`workspace-tool-responsibility-plan.md`](docs/workspace-tool-responsibility-plan.md) | 司书库保存链路、工具权限与模型职责分层 |
| [`save-workspace-interface-map.md`](docs/save-workspace-interface-map.md) | 当前保存 / 读取接口地图 |
| [`event-arc-system-intent.md`](docs/event-arc-system-intent.md) | 动态事件弧系统权威意图记录 |
| [`orchestrator-prompt-intent.md`](docs/orchestrator-prompt-intent.md) | 回合司辰提示词与调度意图记录 |
| [`story-director-dialogue-intent.md`](docs/story-director-dialogue-intent.md) | 故事写手询问叙事导演的工具链意图 |
| [`agent-flow-ui-redesign-brief.md`](docs/agent-flow-ui-redesign-brief.md) | 模型调用 / 工具调用前端流式显示设计 |
| [`orchestrator-call-phase-split-note.md`](docs/orchestrator-call-phase-split-note.md) | 司辰 calls 拆分为写前 / 写后调用的留档 |
| [`author-mode-novelization-roadmap.md`](docs/author-mode-novelization-roadmap.md) | 早期小说化路线（参考） |
| [`author-mode-random-events-plan.md`](docs/author-mode-random-events-plan.md) | 早期长线事件计划（参考） |

## 本地 API 联调

```bash
node scripts/test-api.mjs [model]
```

该脚本用于本地 OpenAI 兼容代理联调。请通过环境变量提供配置：

```bash
LRPG_API_BASE=http://127.0.0.1:8317/v1
LRPG_API_KEY=your_api_key
LRPG_TEST_MODEL=deepseek-v4-flash
```

## 其他

此项目在代码实现上为 vibe coding 产物。
prompt和预设故事除外，这种让模型写起来太艹蛋了。
高考完成前后，随缘维护了，当前执笔模式新做的的提示词和模型配置改动明显不够完善，游历模式也没有跟进更新，bug居多，暂时无心力

所用模型：

```text
初期 & 前端 & 部分prompt：opus 4.7
维护：gpt 5.5
```

## 执笔模式

这是当前的主要方向。

执笔模式会产生大量 token 消耗，并在一轮对话中多次调用模型以跟踪故事。在当前版本，存在大量不合理的token浪费，确保你拥有足够的**经济能力**或**可靠的渠道**来体验执笔模式。

模型分类：司辰，故事（特殊模型），calls模型（成员模型），tools模型（分析工具）
calls模型可使用工具完成任务，本回合是否执行和执行顺序受到司辰的调控
tools模型不能使用工具，固定输入，职责相对较细
司辰模型：负责初步判断故事发展，以激活本回合可能需要的对应模型，可调用tools模型帮助完成任务，多轮对话，先分析后顺序
故事模型：每回合可拉起导演模型一次，拥有被被限制的read工具

## 关于项目

本项目的一部分灵感来源于酒馆，并未对其实现进行参照。
主要方向为“token 换故事质量与体验”，目标是让玩家用尽可能少的工作来体验尽可能高质量的故事，玩家即是作者，也是主角。游戏过程就像 vibe coding，不需要碰类似酒馆的较高门槛，也能得到很好的体验，只需输出想法，就能沉浸在自己与模型创造的故事氛围中。

## 最近改动

- 大改提示词与其结构，重写执笔模式；当前执笔模式强依赖工具调用。
- 添加司书库，作为 Agent 之间协作文件的交流中枢。
- 多轮执行依靠工具调用：calls 模型能够意识到自己需要信息 → 调用工具 → 继续完成任务。
- 模型拉起：司辰模型可拉起 tools 模型进行信息收集；tools 模型完成任务后继续调用司辰模型，并为之后的模型共享工具获取的信息，类似 Claude Code 中的 subagent 功能（但有更明显的上下级关系）。
- 故事模型细化职责，与叙事导演模型绑定；每回合故事可再次拉起一轮叙事导演并询问问题。
- 执笔模式每个 Agent 可选模型。
- 优化前端。

## 即将实现

- **调控模型**（now）：综合判断，主动调控模型调用，控制故事和成本效益（已实现回合司辰，仍需打磨）。
- **agent 化**（now）：重写执笔模式核心逻辑，之后将强需求工具调用（tool calls）。
- **工具调用优化**（now）：完善 Agent 写入工具与司书库沉淀规则。
- **关系分析模型**（约 V0.3）：独立分析每个 NPC 的关系阶段、当前情绪、隐藏欲望，让人物推进更细腻。
- **时间线 / 场景连续性模型**（约 V0.3）：自动维护时间一致性、检测时间矛盾、追踪场景稳定事实。
- **伏笔追踪模型**（约 V0.3）：自动识别伏笔、维护铺垫 / 可回收 / 已回收状态，向更完整的小说结构靠拢。
- **事件弧进度更新**（约 V0.2）：让长线事件不靠回合数硬推进，而由决策模型读故事内容判断真实进展。
- **轻量化的执笔模式**（未定）：完善当前执笔模式后，将效益高的模型融入游历模式，并基于执笔模式去除 / 融合效益低的模型。
- **主弧 / 关系图 / 时间线 / 伏笔的完整编辑器 UI**（未定）。
- **模型链路提示词编辑器**（未定）：在设置页暴露每个 system / user 模板，允许玩家覆盖默认。
- **各模型独立配置**（未定）：每个 agent 可独立选模型 / 温度 / token / 重试。

## License

GPL-3.0 license。
