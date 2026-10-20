# 文档导航

## 当前文档（V2 现行）

- [`destiny-driven-story-core.md`](destiny-driven-story-core.md)：V2 产品定位与最高设计约束。**改提示词、状态结构或前端交互前先读这篇。**
- [`PROJECT_STATUS.md`](PROJECT_STATUS.md)：与代码同步的实现状态——架构、数据流、协议字段、存储键、测试体系、已移除的遗留部分。
- [`story-framework-brief.md`](story-framework-brief.md)：故事框架现状、预设故事格式规则，以及「幕系统 + 随机事件强化」提案的评估简报（自包含，含源码事实与待回答问题，供外部模型评审）。
- [`act-system-plan.md`](act-system-plan.md)：幕系统改造的决议记录与实施计划（数据模型增量、P1-P6 步骤、验收口径、风险与回滚）。
- [`cache-prefix-investigation.md`](cache-prefix-investigation.md)：前缀缓存调研——四个失效点的查证（含 DSH 源码与 DeepSeek 官方文档依据）、已修缺陷与仍需判断的问题。
- [`cost-analysis.md`](cost-analysis.md)：一次真实三回合游玩的成本实测与优化优先级（含官方价格换算：输出占 82% 费用、时段差价 2 倍、缓存优化上限约 16%）。
- [`frontend-interaction-polish.md`](frontend-interaction-polish.md)：四项前端交互优化的成因与实现（自动滚动、正文闪烁、草稿保留、侧边栏更新特效）。
- [`known-issues.md`](known-issues.md)：审查与测试中发现、尚未修复的问题登记（含严重度、影响路径与处理建议）。
- [`multiround-generation-evaluation.md`](multiround-generation-evaluation.md)：评估「是否该把故事回合拆成多轮增量生成」——含 29 个真实回合的量化证据、被证伪的假设与推荐的替代方案。
- [`planner-multiround-evaluation.md`](planner-multiround-evaluation.md)：评估「规划模型是否需要类似 agent 的多轮工作」——结论是不需要，它需要的是被校验；含模型分工定位、体量实测与历史失败模式的归类。
- [`prompt-list.md`](prompt-list.md)：当前实际存在的提示词与协议位置清单。
- [`release-notes-v0.3.0.md`](release-notes-v0.3.0.md)：v0.3.0 发布说明。

仓库根目录另有：

- [`../AGENTS.md`](../AGENTS.md)：接手约定（运行命令、代码结构、路由、存储键、开发注意事项）。
- [`../PROJECT_HANDOFF.md`](../PROJECT_HANDOFF.md)：接手记录、已处理的问题与仍需人工完成的事项。

## 归档文档

- `archive/v1/`：旧多 Agent 执笔链文档，已不参与当前主链路；对应代码已在接手清理中删除。
- `archive/v2/`：V2 早期迁移文档，已与当前实现不一致。
- `archive/reference/`：第三方参考材料。

## 需要注意的历史包袱

- 归档文档中出现的 `src/prompts/*`、`src/services/storyAgent.ts`、`src/store/useGameStore.ts`、`src/pages/LibraryPage.tsx`、`storage/ledgerRepository.ts` 等路径**在当前代码中已不存在**，仅作历史参考，不要照此开发。
