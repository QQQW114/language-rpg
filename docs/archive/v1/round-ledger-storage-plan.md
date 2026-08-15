# 回合卷宗存储方案（IndexedDB）

当前方向：保持纯前端，不引入本地后端；把主存档从 `localStorage` 迁到 IndexedDB。

## 已落地的基础结构

- `localStorage` 只保存轻量入口状态：
  - `activeSaveId`
- IndexedDB 数据库：
  - `language-rpg-ledger`
  - `saves`：旅程元数据、配置、当前衍生状态（不保存完整 `history` / `agentThoughts`）
  - `rounds`：按回合保存消息 JSON
  - `agentCalls`：按模型调用保存记录
  - `snapshots`：回合前后状态快照

## 当前代码入口

- 类型：`src/types/ledger.ts`
- IndexedDB 仓库：`src/storage/ledgerRepository.ts`
- ZIP 导出 / 导入解析：`src/lib/ledgerJourneyPackage.ts`
- Zustand 接入：`src/store/useGameStore.ts`
- 启动水合：`src/App.tsx`
- 旅程导出：`src/pages/GamePage.tsx`
- 旅程导入：`src/pages/HomePage.tsx`
- 模型实际输入记录：
  - `src/services/llmClient.ts` 会为每次请求生成 `AgentPromptTrace`
  - 各 agent service 通过非枚举 `trace` 字段传回调用方，避免把完整 prompt 重复写入业务 state
- 前端空间显示：
  - `src/components/AgentThoughtsPanel.tsx` 的“记录”页展示当前旅程占用、回合/调用/快照拆分、浏览器源级存储估算

## 存储原则

1. `rounds` 是聊天/故事文本的持久化来源。
2. `agentCalls` 是模型调用记录的持久化来源。
3. `agentCalls.input` 保存实际 `system/user/messages` 调用输入；`think/output/usage` 与其同归档。
4. `saves.state` 只保存当前运行态和衍生状态，不重复保存完整聊天记录。
5. `snapshots` 为“编辑 / 删除 / 重写后回溯”提供基础。

## 已处理的关键缺口

- 编辑 / 删除 / 重写消息已切到“读取 snapshot → 回滚 → 截断后续卷宗 → 重新生成”的流程。
- 各 service 已返回 `trace`，模型记录面板可查看 `input / think / output`。
- 导入 ZIP 会生成新 saveId / roundId / callId / snapshotId，避免覆盖同 id 的本地旅程。

## 后续仍可增强

- 对浏览器实际跑一轮长流程冒烟，重点测旧回合编辑、删除、重新请求后 NPC / 背包 / 场景 / 主弧是否按预期回溯。
- 导入 ZIP 时可进一步重映射资源 id（outline/worldBook/event），避免与书库同名/同 id 资源冲突。
- 可加“清理旧 trace / 压缩旧快照”的维护按钮，避免极长旅程无限增长。
