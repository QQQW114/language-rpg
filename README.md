# 言灵 · Language RPG V2

纯前端、双模型驱动的中文互动小说。

## 核心架构

每轮只使用两种模型：

1. **规划 Agent**：读取程序侧权威状态，完成写前规划；故事生成后延续同一会话，提交人物、关系、物品、任务和场景变化 Patch。
2. **故事 Agent**：只根据 writing brief 生成小说正文。

状态写入由程序校验，模型不能直接修改数据库或资料文件。

## 模式

- **执笔模式**：固定无限回合，每轮由玩家自由输入，不使用选项刷新、回合上限或旧角色模型。
- **游历模式**：复用同一个回合引擎，规划 Agent 在写后生成 2～4 个行动选项，同时仍允许自由输入。

## 数据

V2 使用独立浏览器存储 `lrpg.v2`，不兼容旧存档。

权威状态包括：

- 人物与已知事实
- 人物关系与好感
- 库存数量与类型
- 故事线程 / 任务
- 当前场景
- 故事摘要与最新进度

世界书作为创建旅程时选择的可检索事实资料，不再驱动独立设定守护或多 Agent 链。

## 启动

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 故事链路测试

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

## 技术栈

Vite + React 18 + TypeScript + Zustand + Tailwind CSS。

License: GPL-3.0。
