# 文档导航

## 当前文档（V2 现行）

- [`destiny-driven-story-core.md`](destiny-driven-story-core.md)：V2 产品定位与最高设计约束。**改提示词、状态结构或前端交互前先读这篇。**
- [`PROJECT_STATUS.md`](PROJECT_STATUS.md)：与代码同步的实现状态——架构、数据流、协议字段、存储键、测试体系、已移除的遗留部分。
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
